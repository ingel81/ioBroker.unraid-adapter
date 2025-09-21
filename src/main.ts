import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';

import { UnraidApolloClient } from './apollo-client';
import { SubscriptionManager } from './subscription-manager';
import {
    allDomainIds,
    defaultEnabledDomains,
    domainDefinitionById,
    domainNodeById,
    expandSelection,
    type DomainDefinition,
    type DomainId,
    type FieldSpec,
    type RootSelection,
    type StateMapping,
} from './shared/unraid-domains';

type AdapterSettings = {
    baseUrl: string;
    apiToken: string;
    pollIntervalSeconds: number;
    allowSelfSigned: boolean;
    enabledDomains: DomainId[];
    useSubscriptions?: boolean;
};

type QueryResult = Record<string, unknown>;

class GraphQLSelectionBuilder {
    private readonly roots = new Map<string, FieldNode>();

    public addSelections(selections: readonly RootSelection[]): void {
        for (const selection of selections) {
            if (!selection.fields.length) {
                continue;
            }
            const rootNode = this.getOrCreateRoot(selection.root);
            this.addFields(rootNode, selection.fields);
        }
    }

    public build(): string | null {
        if (!this.roots.size) {
            return null;
        }

        const sections: string[] = [];
        const sortedRoots = Array.from(this.roots.keys()).sort((left, right) => left.localeCompare(right));

        for (const root of sortedRoots) {
            const node = this.roots.get(root);
            if (!node) {
                continue;
            }
            const body = this.printNode(node, 8);
            const section = body
                ? `    ${root} {\n${body}\n    }`
                : `    ${root}`;
            sections.push(section);
        }

        const queryBody = sections.join('\n');
        return `query UnraidAdapterFetch {\n${queryBody}\n}`;
    }

    private getOrCreateRoot(root: string): FieldNode {
        const existing = this.roots.get(root);
        if (existing) {
            return existing;
        }
        const node: FieldNode = new Map();
        this.roots.set(root, node);
        return node;
    }

    private addFields(target: FieldNode, fields: readonly FieldSpec[]): void {
        for (const field of fields) {
            let child = target.get(field.name);
            if (!child) {
                child = new Map();
                target.set(field.name, child);
            }
            if (field.selection?.length) {
                this.addFields(child, field.selection);
            }
        }
    }

    private printNode(node: FieldNode, indent: number): string {
        if (!node.size) {
            return '';
        }

        const indentString = ' '.repeat(indent);
        const entries = Array.from(node.entries()).sort((left, right) => left[0].localeCompare(right[0]));

        return entries
            .map(([name, child]) => {
                if (!child.size) {
                    return `${indentString}${name}`;
                }
                const body = this.printNode(child, indent + 4);
                if (!body) {
                    return `${indentString}${name}`;
                }
                return `${indentString}${name} {\n${body}\n${indentString}}`;
            })
            .join('\n');
    }
}

type FieldNode = Map<string, FieldNode>;

class UnraidAdapter extends Adapter {
    private pollIntervalMs = 60000;
    private pollTimer?: ioBroker.Timeout;
    private stopRequested = false;
    private apolloClient?: UnraidApolloClient;
    private subscriptionManager?: SubscriptionManager;
    private useSubscriptions = false;
    private subscriptionsActive = false;

    private rawSelection: Set<DomainId> = new Set();
    private effectiveSelection: Set<DomainId> = new Set();
    private selectedDefinitions: DomainDefinition[] = [];
    private staticObjectIds: Set<string> = new Set();

    private readonly createdChannels = new Set<string>();
    private readonly createdStates = new Set<string>();

    // Dynamic CPU core tracking
    private cpuCoresDetected = false;
    private cpuCoreCount = 0;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'unraid',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    private async onReady(): Promise<void> {
        try {
            const settings = this.validateSettings();
            if (!settings) {
                this.log.warn('Adapter is idle because the configuration is incomplete.');
                return;
            }

            this.configureSelection(settings.enabledDomains);

            if (!this.selectedDefinitions.length) {
                this.log.warn('No domains selected. Configure at least one domain in the adapter settings.');
                return;
            }

            // Always initialize Apollo Client for both polling and subscriptions
            this.apolloClient = new UnraidApolloClient({
                baseUrl: settings.baseUrl,
                apiToken: settings.apiToken,
                allowSelfSigned: settings.allowSelfSigned,
            });

            this.pollIntervalMs = settings.pollIntervalSeconds * 1000;
            this.useSubscriptions = settings.useSubscriptions ?? false;

            await this.cleanupObjectTree(this.staticObjectIds);
            await this.initializeStaticStates(this.selectedDefinitions);

            // Subscription support disabled for now (API issues)
            // if (this.useSubscriptions) {
            //     await this.initializeSubscriptions();
            // }

            // Start polling
            await this.pollOnce();
            this.scheduleNextPoll();
        } catch (error) {
            this.log.error(`Failed to initialise adapter: ${this.describeError(error)}`);
        }
    }

    private configureSelection(enabledDomains: readonly DomainId[]): void {
        this.rawSelection = new Set(enabledDomains);
        this.effectiveSelection = expandSelection(this.rawSelection);

        const definitions: DomainDefinition[] = [];
        for (const id of this.effectiveSelection) {
            const definition = domainDefinitionById.get(id);
            if (definition) {
                definitions.push(definition);
            }
        }
        this.selectedDefinitions = definitions;
        this.staticObjectIds = this.collectStaticObjectIds(definitions);
    }

    private collectStaticObjectIds(definitions: readonly DomainDefinition[]): Set<string> {
        const ids = new Set<string>();

        const addPrefixes = (identifier: string): void => {
            const parts = identifier.split('.');
            for (let index = 1; index <= parts.length; index += 1) {
                ids.add(parts.slice(0, index).join('.'));
            }
        };

        for (const definition of definitions) {
            addPrefixes(definition.id);
            for (const state of definition.states) {
                addPrefixes(state.id);
            }
        }

        return ids;
    }

    private async initializeSubscriptions(): Promise<void> {
        try {
            this.log.info('Initializing subscriptions...');

            if (!this.apolloClient) {
                throw new Error('Apollo client not initialized');
            }

            this.subscriptionManager = new SubscriptionManager({
                apolloClient: this.apolloClient,
                onStateUpdate: async (id: string, value: unknown) => {
                    // Convert value to proper format and write state
                    const normalizedValue = value === undefined ? null : (value as ioBroker.StateValue | null);
                    await this.setStateAsync(id, { val: normalizedValue, ack: true });
                },
                onError: (error) => {
                    this.log.warn(`Subscription error: ${error.message}`);
                },
                onConnectionLost: () => {
                    this.log.warn('WebSocket connection lost, falling back to polling for CPU/Memory');
                    this.subscriptionsActive = false;
                },
                onConnectionRestored: () => {
                    this.log.info('WebSocket connection restored, using subscriptions for CPU/Memory');
                    this.subscriptionsActive = true;
                },
            });

            const success = await this.subscriptionManager.start();
            if (success) {
                this.subscriptionsActive = true;
                this.log.info('Subscriptions active for CPU and Memory metrics');
            } else {
                this.log.warn('Subscriptions not available, using polling for all metrics');
            }
        } catch (error) {
            this.log.error(`Failed to initialize subscriptions: ${this.describeError(error)}`);
            this.log.info('Falling back to polling for all metrics');
        }
    }

    private validateSettings(): AdapterSettings | null {
        const baseUrl = (this.config.baseUrl ?? '').trim();
        const apiToken = (this.config.apiToken ?? '').trim();
        const pollIntervalSecondsRaw = Number(this.config.pollIntervalSeconds ?? 60);
        const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : 60;
        const allowSelfSigned = Boolean(this.config.allowSelfSigned);
        const useSubscriptions = Boolean(this.config.useSubscriptions);

        const enabledDomainsRaw = Array.isArray(this.config.enabledDomains)
            ? (this.config.enabledDomains as string[])
            : [...defaultEnabledDomains];

        const knownIds = new Set(allDomainIds);
        const enabledDomains: DomainId[] = [];
        for (const id of enabledDomainsRaw) {
            if (knownIds.has(id as DomainId)) {
                enabledDomains.push(id as DomainId);
            }
        }

        if (!enabledDomains.length) {
            enabledDomains.push(...(defaultEnabledDomains as DomainId[]));
        }

        if (!baseUrl) {
            this.log.error('Base URL is not configured.');
            return null;
        }

        if (!apiToken) {
            this.log.error('API token is not configured.');
            return null;
        }

        return {
            baseUrl,
            apiToken,
            pollIntervalSeconds,
            allowSelfSigned,
            enabledDomains,
            useSubscriptions,
        };
    }

    private scheduleNextPoll(): void {
        if (this.stopRequested) {
            return;
        }

        this.pollTimer = this.setTimeout(() => {
            void this.pollOnce()
                .catch((error) => {
                    this.log.error(`Polling failed: ${this.describeError(error)}`);
                })
                .finally(() => {
                    this.scheduleNextPoll();
                });
        }, this.pollIntervalMs);
    }

    private async pollOnce(): Promise<void> {
        if (!this.apolloClient) {
            throw new Error('Apollo client is not initialised');
        }

        if (!this.selectedDefinitions.length) {
            this.log.debug('Skipping poll because no domains are selected.');
            return;
        }

        const query = this.buildQuery(this.selectedDefinitions);
        if (!query) {
            this.log.warn('No query could be built for the current selection.');
            return;
        }

        try {
            const data = await this.apolloClient.query<QueryResult>(query);
            this.logGraphQLResponse(data);
            await this.applyData(data);
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`GraphQL error: ${error.message}`);
            }
            throw error;
        }
    }

    private buildQuery(definitions: readonly DomainDefinition[]): string | null {
        const builder = new GraphQLSelectionBuilder();
        for (const definition of definitions) {
            builder.addSelections(definition.selection);
        }
        return builder.build();
    }

    private async applyData(data: QueryResult): Promise<void> {
        // Check for CPU cores and create states dynamically if needed
        await this.handleDynamicCpuCores(data);

        for (const definition of this.selectedDefinitions) {
            await this.applyDefinition(definition, data);
        }
    }

    private async initializeStaticStates(definitions: readonly DomainDefinition[]): Promise<void> {
        for (const definition of definitions) {
            for (const mapping of definition.states) {
                await this.writeState(mapping.id, mapping.common, null);
            }
        }
    }

    private async handleDynamicCpuCores(data: QueryResult): Promise<void> {
        // Only process CPU cores if metrics.cpu is selected and data is available
        const metrics = data.metrics as { cpu?: { cpus?: unknown[] } };
        if (!metrics?.cpu?.cpus) {
            return;
        }

        const cores = metrics.cpu.cpus;
        const coreCount = Array.isArray(cores) ? cores.length : 0;

        // Create CPU core states on first detection or if core count changed
        if (!this.cpuCoresDetected || this.cpuCoreCount !== coreCount) {
            this.cpuCoreCount = coreCount;
            this.cpuCoresDetected = true;

            this.log.info(`Detected ${coreCount} CPU cores, creating states...`);

            // Create core count state
            await this.writeState(
                'metrics.cpu.cores.count',
                { type: 'number', role: 'value', unit: '' },
                coreCount
            );

            // Create states for each CPU core
            for (let i = 0; i < coreCount; i++) {
                const corePrefix = `metrics.cpu.cores.${i}`;

                // Create states for this core
                await this.writeState(`${corePrefix}.percentTotal`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentUser`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentSystem`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentNice`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentIdle`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentIrq`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
            }
        }

        // Update CPU core values
        for (let i = 0; i < cores.length; i++) {
            const core = cores[i] as Record<string, unknown>;
            const corePrefix = `metrics.cpu.cores.${i}`;

            await this.setStateAsync(`${corePrefix}.percentTotal`,
                { val: this.toNumberOrNull(core.percentTotal), ack: true });
            await this.setStateAsync(`${corePrefix}.percentUser`,
                { val: this.toNumberOrNull(core.percentUser), ack: true });
            await this.setStateAsync(`${corePrefix}.percentSystem`,
                { val: this.toNumberOrNull(core.percentSystem), ack: true });
            await this.setStateAsync(`${corePrefix}.percentNice`,
                { val: this.toNumberOrNull(core.percentNice), ack: true });
            await this.setStateAsync(`${corePrefix}.percentIdle`,
                { val: this.toNumberOrNull(core.percentIdle), ack: true });
            await this.setStateAsync(`${corePrefix}.percentIrq`,
                { val: this.toNumberOrNull(core.percentIrq), ack: true });
        }
    }

    private toNumberOrNull(value: unknown): number | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    private async applyDefinition(definition: DomainDefinition, data: QueryResult): Promise<void> {
        // First check if this domain's data exists in the result
        const rootPath = definition.selection[0]?.root;
        if (!rootPath || !(rootPath in data)) {
            // Skip if this domain wasn't queried
            return;
        }

        for (const mapping of definition.states) {
            const rawValue = this.resolveValue(data, mapping.path);
            const transformed = mapping.transform ? mapping.transform(rawValue) : rawValue;
            await this.writeState(mapping.id, mapping.common, transformed);
        }
    }

    private resolveValue(source: unknown, path: readonly string[]): unknown {
        let current: unknown = source;
        for (const segment of path) {
            if (!current || typeof current !== 'object') {
                return null;
            }
            current = (current as Record<string, unknown>)[segment];
        }
        return current === undefined ? null : current;
    }

    private async cleanupObjectTree(allowedIds: Set<string>): Promise<void> {
        const objects = await this.getAdapterObjectsAsync();
        for (const fullId of Object.keys(objects)) {
            const relativeId = fullId.startsWith(`${this.namespace}.`)
                ? fullId.slice(this.namespace.length + 1)
                : fullId;

            if (!relativeId) {
                continue;
            }

            if (!this.shouldKeepObject(relativeId, allowedIds)) {
                try {
                    await this.delObjectAsync(relativeId, { recursive: true });
                } catch (error) {
                    this.log.warn(`Failed to remove object ${relativeId}: ${this.describeError(error)}`);
                }
            }
        }

        this.createdChannels.clear();
        this.createdStates.clear();
    }

    private shouldKeepObject(objectId: string, allowedIds: Set<string>): boolean {
        if (allowedIds.has(objectId)) {
            return true;
        }

        const parts = objectId.split('.');
        for (let index = parts.length - 1; index > 0; index -= 1) {
            const candidate = parts.slice(0, index).join('.');
            if (allowedIds.has(candidate)) {
                return true;
            }
        }

        return false;
    }

    private async ensureChannelHierarchy(id: string): Promise<void> {
        const parts = id.split('.');
        for (let index = 1; index < parts.length; index += 1) {
            const channelId = parts.slice(0, index).join('.');
            if (this.createdChannels.has(channelId)) {
                continue;
            }

            const labelKey = domainNodeById.get(channelId as DomainId)?.label ?? channelId;
            await this.setObjectNotExistsAsync(channelId, {
                type: 'channel',
                common: {
                    name: labelKey,
                },
                native: {},
            });
            this.createdChannels.add(channelId);
        }
    }

    private async writeState(id: string, common: StateMapping['common'], value: unknown): Promise<void> {
        await this.ensureChannelHierarchy(id);

        if (!this.createdStates.has(id)) {
            await this.setObjectNotExistsAsync(id, {
                type: 'state',
                common: {
                    name: id,
                    role: common.role,
                    type: common.type,
                    unit: common.unit,
                    read: true,
                    write: false,
                },
                native: {},
            });
            this.createdStates.add(id);
        }

        const normalizedValue = value === undefined ? null : (value as ioBroker.StateValue | null);
        await this.setStateAsync(id, { val: normalizedValue, ack: true });
    }

    private logGraphQLResponse(data: QueryResult): void {
        try {
            const serialized = JSON.stringify(data);
            const maxLength = 3000;
            const output = serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
            this.log.debug(`GraphQL response: ${output}`);
        } catch (error) {
            this.log.debug(`GraphQL response received but could not be stringified: ${this.describeError(error)}`);
        }
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            this.log.debug(`State ${id} changed: ${state.val} (ack=${state.ack})`);
        }
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    private onUnload(callback: () => void): void {
        this.stopRequested = true;
        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
            }
            if (this.subscriptionManager) {
                void this.subscriptionManager.stop().catch((error) => {
                    this.log.warn(`Failed to stop subscriptions: ${this.describeError(error)}`);
                });
            }
            if (this.apolloClient) {
                void this.apolloClient.dispose().catch((error) => {
                    this.log.warn(`Failed to dispose Apollo client: ${this.describeError(error)}`);
                });
            }
        } finally {
            callback();
        }
    }
}

if (module.parent) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new UnraidAdapter(options);
} else {
    (() => new UnraidAdapter())();
}
