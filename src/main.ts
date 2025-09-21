import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';

import {
    GraphQLClient,
    GraphQLHttpError,
    GraphQLRequestError,
    GraphQLResponseError,
} from './graphql-client';
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
    private client?: GraphQLClient;

    private rawSelection: Set<DomainId> = new Set();
    private effectiveSelection: Set<DomainId> = new Set();
    private selectedDefinitions: DomainDefinition[] = [];
    private staticObjectIds: Set<string> = new Set();

    private readonly createdChannels = new Set<string>();
    private readonly createdStates = new Set<string>();

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

            this.client = new GraphQLClient({
                baseUrl: settings.baseUrl,
                token: settings.apiToken,
                allowSelfSigned: settings.allowSelfSigned,
            });

            this.pollIntervalMs = settings.pollIntervalSeconds * 1000;

            await this.cleanupObjectTree(this.staticObjectIds);
            await this.initializeStaticStates(this.selectedDefinitions);
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

    private validateSettings(): AdapterSettings | null {
        const baseUrl = (this.config.baseUrl ?? '').trim();
        const apiToken = (this.config.apiToken ?? '').trim();
        const pollIntervalSecondsRaw = Number(this.config.pollIntervalSeconds ?? 60);
        const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : 60;
        const allowSelfSigned = Boolean(this.config.allowSelfSigned);

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
        if (!this.client) {
            throw new Error('GraphQL client is not initialised');
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
            const data = await this.client.query<QueryResult>(query);
            this.logGraphQLResponse(data);
            await this.applyData(data);
        } catch (error) {
            if (error instanceof GraphQLHttpError) {
                throw new Error(`GraphQL HTTP error ${error.status}: ${error.body || error.message}`);
            }
            if (error instanceof GraphQLRequestError || error instanceof GraphQLResponseError) {
                throw new Error(error.message);
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

    private async applyDefinition(definition: DomainDefinition, data: QueryResult): Promise<void> {
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
            if (this.client) {
                void this.client.dispose().catch((error) => {
                    this.log.warn(`Failed to dispose GraphQL client: ${this.describeError(error)}`);
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
