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

    // Dynamic array disk tracking
    private arrayDisksDetected = false;
    private diskCount = 0;
    private parityCount = 0;
    private cacheCount = 0;

    // Dynamic docker container tracking
    private dockerContainersDetected = false;
    private containerNames: Set<string> = new Set();

    // Dynamic shares tracking
    private sharesDetected = false;
    private shareNames: Set<string> = new Set();

    // Dynamic VM tracking
    private vmsDetected = false;
    private vmUuids: Set<string> = new Set();

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

        // Reset dynamic tracking for deselected domains
        if (!this.effectiveSelection.has('metrics.cpu')) {
            this.cpuCoresDetected = false;
            this.cpuCoreCount = 0;
        }

        if (!this.effectiveSelection.has('array.disks') &&
            !this.effectiveSelection.has('array.parities') &&
            !this.effectiveSelection.has('array.caches')) {
            this.arrayDisksDetected = false;
            this.diskCount = 0;
            this.parityCount = 0;
            this.cacheCount = 0;
        }

        if (!this.effectiveSelection.has('docker.containers')) {
            this.dockerContainersDetected = false;
            this.containerNames.clear();
        }

        if (!this.effectiveSelection.has('shares.list')) {
            this.sharesDetected = false;
            this.shareNames.clear();
        }

        if (!this.effectiveSelection.has('vms.list')) {
            this.vmsDetected = false;
            this.vmUuids.clear();
        }
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
        // Only check for CPU cores if metrics.cpu is selected
        if (this.effectiveSelection.has('metrics.cpu')) {
            await this.handleDynamicCpuCores(data);
        }

        // Only check for array disks if any array disk domain is selected
        if (this.effectiveSelection.has('array.disks') ||
            this.effectiveSelection.has('array.parities') ||
            this.effectiveSelection.has('array.caches')) {
            await this.handleDynamicArrayDisks(data);
        }

        // Only check for docker containers if docker.containers is selected
        if (this.effectiveSelection.has('docker.containers')) {
            await this.handleDynamicDockerContainers(data);
        }

        // Only check for shares if shares.list is selected
        if (this.effectiveSelection.has('shares.list')) {
            await this.handleDynamicShares(data);
        }

        // Only check for VMs if vms.list is selected
        if (this.effectiveSelection.has('vms.list')) {
            await this.handleDynamicVms(data);
        }

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
        // Only process CPU cores if metrics.cpu is selected
        if (!this.effectiveSelection.has('metrics.cpu')) {
            return;
        }

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

    private async handleDynamicArrayDisks(data: QueryResult): Promise<void> {
        // Check if any array disk domains are selected
        const hasDisks = this.effectiveSelection.has('array.disks');
        const hasParities = this.effectiveSelection.has('array.parities');
        const hasCaches = this.effectiveSelection.has('array.caches');

        // Skip if no array disk domains are selected
        if (!hasDisks && !hasParities && !hasCaches) {
            return;
        }

        const array = data.array as {
            disks?: unknown[];
            parities?: unknown[];
            caches?: unknown[];
        };
        if (!array) {
            return;
        }

        const disks = hasDisks && Array.isArray(array.disks) ? array.disks : [];
        const parities = hasParities && Array.isArray(array.parities) ? array.parities : [];
        const caches = hasCaches && Array.isArray(array.caches) ? array.caches : [];

        const diskCount = hasDisks ? disks.length : this.diskCount;
        const parityCount = hasParities ? parities.length : this.parityCount;
        const cacheCount = hasCaches ? caches.length : this.cacheCount;

        // Create or update disk states if needed
        if (!this.arrayDisksDetected ||
            (hasDisks && this.diskCount !== diskCount) ||
            (hasParities && this.parityCount !== parityCount) ||
            (hasCaches && this.cacheCount !== cacheCount)) {

            if (hasDisks) this.diskCount = diskCount;
            if (hasParities) this.parityCount = parityCount;
            if (hasCaches) this.cacheCount = cacheCount;
            this.arrayDisksDetected = true;

            this.log.info(`Detected array configuration: ${diskCount} data disks, ${parityCount} parity disks, ${cacheCount} cache disks`);

            // Create count states only for selected domains
            if (hasDisks) {
                await this.writeState('array.disks.count',
                    { type: 'number', role: 'value', unit: '' }, diskCount);
                await this.createDiskStates('array.disks', disks);
            }

            if (hasParities) {
                await this.writeState('array.parities.count',
                    { type: 'number', role: 'value', unit: '' }, parityCount);
                await this.createDiskStates('array.parities', parities);
            }

            if (hasCaches) {
                await this.writeState('array.caches.count',
                    { type: 'number', role: 'value', unit: '' }, cacheCount);
                await this.createDiskStates('array.caches', caches);
            }
        }

        // Update disk values only for selected domains
        if (hasDisks && disks.length > 0) {
            await this.updateDiskValues('array.disks', disks);
        }
        if (hasParities && parities.length > 0) {
            await this.updateDiskValues('array.parities', parities);
        }
        if (hasCaches && caches.length > 0) {
            await this.updateDiskValues('array.caches', caches);
        }
    }

    private async createDiskStates(prefix: string, disks: unknown[]): Promise<void> {
        for (let i = 0; i < disks.length; i++) {
            const disk = disks[i] as Record<string, unknown>;
            const diskPrefix = `${prefix}.${disk.idx ?? i}`;

            // Basic info states
            await this.writeState(`${diskPrefix}.name`,
                { type: 'string', role: 'text' }, null);
            await this.writeState(`${diskPrefix}.device`,
                { type: 'string', role: 'text' }, null);
            await this.writeState(`${diskPrefix}.status`,
                { type: 'string', role: 'indicator.status' }, null);
            await this.writeState(`${diskPrefix}.temp`,
                { type: 'number', role: 'value.temperature', unit: '°C' }, null);
            await this.writeState(`${diskPrefix}.type`,
                { type: 'string', role: 'text' }, null);

            // Size states
            await this.writeState(`${diskPrefix}.sizeGb`,
                { type: 'number', role: 'value', unit: 'GB' }, null);
            await this.writeState(`${diskPrefix}.fsSizeGb`,
                { type: 'number', role: 'value', unit: 'GB' }, null);
            await this.writeState(`${diskPrefix}.fsUsedGb`,
                { type: 'number', role: 'value', unit: 'GB' }, null);
            await this.writeState(`${diskPrefix}.fsFreeGb`,
                { type: 'number', role: 'value', unit: 'GB' }, null);
            await this.writeState(`${diskPrefix}.fsUsedPercent`,
                { type: 'number', role: 'value.percent', unit: '%' }, null);

            // File system info
            await this.writeState(`${diskPrefix}.fsType`,
                { type: 'string', role: 'text' }, null);
            await this.writeState(`${diskPrefix}.isSpinning`,
                { type: 'boolean', role: 'indicator' }, null);

            // Performance counters
            await this.writeState(`${diskPrefix}.numReads`,
                { type: 'number', role: 'value' }, null);
            await this.writeState(`${diskPrefix}.numWrites`,
                { type: 'number', role: 'value' }, null);
            await this.writeState(`${diskPrefix}.numErrors`,
                { type: 'number', role: 'value' }, null);

            // Temperature thresholds
            await this.writeState(`${diskPrefix}.warning`,
                { type: 'number', role: 'value.temperature', unit: '°C' }, null);
            await this.writeState(`${diskPrefix}.critical`,
                { type: 'number', role: 'value.temperature', unit: '°C' }, null);

            // Additional info
            await this.writeState(`${diskPrefix}.rotational`,
                { type: 'boolean', role: 'indicator' }, null);
            await this.writeState(`${diskPrefix}.transport`,
                { type: 'string', role: 'text' }, null);
        }
    }

    private async updateDiskValues(prefix: string, disks: unknown[]): Promise<void> {
        for (const disk of disks) {
            const d = disk as Record<string, unknown>;
            const diskPrefix = `${prefix}.${d.idx ?? disks.indexOf(disk)}`;

            await this.setStateAsync(`${diskPrefix}.name`,
                { val: this.toStringOrNull(d.name), ack: true });
            await this.setStateAsync(`${diskPrefix}.device`,
                { val: this.toStringOrNull(d.device), ack: true });
            await this.setStateAsync(`${diskPrefix}.status`,
                { val: this.toStringOrNull(d.status), ack: true });
            await this.setStateAsync(`${diskPrefix}.temp`,
                { val: this.toNumberOrNull(d.temp), ack: true });
            await this.setStateAsync(`${diskPrefix}.type`,
                { val: this.toStringOrNull(d.type), ack: true });

            // Convert KB to GB for sizes
            await this.setStateAsync(`${diskPrefix}.sizeGb`,
                { val: this.kilobytesToGigabytes(d.size), ack: true });
            await this.setStateAsync(`${diskPrefix}.fsSizeGb`,
                { val: this.kilobytesToGigabytes(d.fsSize), ack: true });
            await this.setStateAsync(`${diskPrefix}.fsUsedGb`,
                { val: this.kilobytesToGigabytes(d.fsUsed), ack: true });
            await this.setStateAsync(`${diskPrefix}.fsFreeGb`,
                { val: this.kilobytesToGigabytes(d.fsFree), ack: true });

            // Calculate and set fsUsedPercent
            const fsUsedPercent = this.calculateUsagePercent(d.fsUsed, d.fsSize);
            await this.setStateAsync(`${diskPrefix}.fsUsedPercent`,
                { val: fsUsedPercent, ack: true });

            await this.setStateAsync(`${diskPrefix}.fsType`,
                { val: this.toStringOrNull(d.fsType), ack: true });
            await this.setStateAsync(`${diskPrefix}.isSpinning`,
                { val: this.toBooleanOrNull(d.isSpinning), ack: true });

            // BigInt handling for counters
            await this.setStateAsync(`${diskPrefix}.numReads`,
                { val: this.bigIntToNumber(d.numReads), ack: true });
            await this.setStateAsync(`${diskPrefix}.numWrites`,
                { val: this.bigIntToNumber(d.numWrites), ack: true });
            await this.setStateAsync(`${diskPrefix}.numErrors`,
                { val: this.bigIntToNumber(d.numErrors), ack: true });

            await this.setStateAsync(`${diskPrefix}.warning`,
                { val: this.toNumberOrNull(d.warning), ack: true });
            await this.setStateAsync(`${diskPrefix}.critical`,
                { val: this.toNumberOrNull(d.critical), ack: true });

            await this.setStateAsync(`${diskPrefix}.rotational`,
                { val: this.toBooleanOrNull(d.rotational), ack: true });
            await this.setStateAsync(`${diskPrefix}.transport`,
                { val: this.toStringOrNull(d.transport), ack: true });
        }
    }

    private kilobytesToGigabytes(value: unknown): number | null {
        const numeric = this.toNumberOrNull(value);
        if (numeric === null) {
            return null;
        }
        const gb = numeric / (1024 * 1024);
        return Number.isFinite(gb) ? Math.round(gb * 100) / 100 : null;
    }

    private bytesToGigabytes(value: unknown): number | null {
        const numeric = this.toNumberOrNull(value);
        if (numeric === null) {
            return null;
        }
        const gb = numeric / (1024 * 1024 * 1024);
        return Number.isFinite(gb) ? Math.round(gb * 100) / 100 : null;
    }

    private calculateUsagePercent(used: unknown, total: unknown): number | null {
        const usedNumeric = this.toNumberOrNull(used);
        const totalNumeric = this.toNumberOrNull(total);

        // Return null if either value is null or total is 0
        if (usedNumeric === null || totalNumeric === null || totalNumeric === 0) {
            return null;
        }

        const percent = (usedNumeric / totalNumeric) * 100;
        return Number.isFinite(percent) ? Math.round(percent * 100) / 100 : null;
    }

    private async handleDynamicDockerContainers(data: QueryResult): Promise<void> {
        // Only process docker containers if docker.containers is selected
        if (!this.effectiveSelection.has('docker.containers')) {
            return;
        }

        const docker = data.docker as { containers?: unknown[] };
        if (!docker?.containers) {
            return;
        }

        const containers = Array.isArray(docker.containers) ? docker.containers : [];
        const containerNames = new Set<string>();

        for (const container of containers) {
            const c = container as Record<string, unknown>;
            const names = c.names as string[] | null;
            if (names && Array.isArray(names) && names.length > 0) {
                // Use first name, remove leading slash
                const name = names[0].replace(/^\//, '');
                containerNames.add(name);
            }
        }

        // Check if we need to create new container states
        const needsUpdate = !this.dockerContainersDetected ||
            containerNames.size !== this.containerNames.size ||
            ![...containerNames].every(name => this.containerNames.has(name));

        if (needsUpdate) {
            this.containerNames = containerNames;
            this.dockerContainersDetected = true;

            this.log.info(`Detected ${containerNames.size} Docker containers`);

            // Create container count state
            await this.writeState('docker.containers.count',
                { type: 'number', role: 'value', unit: '' }, containerNames.size);

            // Create states for each container
            for (const container of containers) {
                const c = container as Record<string, unknown>;
                const names = c.names as string[] | null;
                if (!names || !Array.isArray(names) || names.length === 0) continue;

                const name = names[0].replace(/^\//, '');
                const containerPrefix = `docker.containers.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.writeState(`${containerPrefix}.name`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${containerPrefix}.image`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${containerPrefix}.state`,
                    { type: 'string', role: 'indicator.status' }, null);
                await this.writeState(`${containerPrefix}.status`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${containerPrefix}.autoStart`,
                    { type: 'boolean', role: 'indicator' }, null);
                await this.writeState(`${containerPrefix}.sizeGb`,
                    { type: 'number', role: 'value', unit: 'GB' }, null);
            }
        }

        // Update container values - only for containers we're tracking
        for (const container of containers) {
            const c = container as Record<string, unknown>;
            const names = c.names as string[] | null;
            if (!names || !Array.isArray(names) || names.length === 0) continue;

            const name = names[0].replace(/^\//, '');

            // Only update if we're still tracking this container
            if (!this.containerNames.has(name)) {
                continue;
            }

            const containerPrefix = `docker.containers.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.setStateAsync(`${containerPrefix}.name`,
                { val: name, ack: true });
            await this.setStateAsync(`${containerPrefix}.image`,
                { val: this.toStringOrNull(c.image), ack: true });
            await this.setStateAsync(`${containerPrefix}.state`,
                { val: this.toStringOrNull(c.state), ack: true });
            await this.setStateAsync(`${containerPrefix}.status`,
                { val: this.toStringOrNull(c.status), ack: true });
            await this.setStateAsync(`${containerPrefix}.autoStart`,
                { val: this.toBooleanOrNull(c.autoStart), ack: true });
            await this.setStateAsync(`${containerPrefix}.sizeGb`,
                { val: this.bytesToGigabytes(c.sizeRootFs), ack: true });
        }
    }

    private async handleDynamicShares(data: QueryResult): Promise<void> {
        // Only process shares if shares.list is selected
        if (!this.effectiveSelection.has('shares.list')) {
            return;
        }

        const shares = data.shares as unknown[];
        if (!shares || !Array.isArray(shares)) {
            return;
        }

        const shareNames = new Set<string>();
        for (const share of shares) {
            const s = share as Record<string, unknown>;
            const name = s.name as string | null;
            if (name) {
                shareNames.add(name);
            }
        }

        // Check if we need to create new share states
        const needsUpdate = !this.sharesDetected ||
            shareNames.size !== this.shareNames.size ||
            ![...shareNames].every(name => this.shareNames.has(name));

        if (needsUpdate) {
            this.shareNames = shareNames;
            this.sharesDetected = true;

            this.log.info(`Detected ${shareNames.size} shares`);

            // Create share count state
            await this.writeState('shares.count',
                { type: 'number', role: 'value', unit: '' }, shareNames.size);

            // Create states for each share
            for (const share of shares) {
                const s = share as Record<string, unknown>;
                const name = s.name as string | null;
                if (!name) continue;

                const sharePrefix = `shares.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.writeState(`${sharePrefix}.name`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${sharePrefix}.freeGb`,
                    { type: 'number', role: 'value', unit: 'GB' }, null);
                await this.writeState(`${sharePrefix}.usedGb`,
                    { type: 'number', role: 'value', unit: 'GB' }, null);
                await this.writeState(`${sharePrefix}.sizeGb`,
                    { type: 'number', role: 'value', unit: 'GB' }, null);
                await this.writeState(`${sharePrefix}.usedPercent`,
                    { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${sharePrefix}.comment`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${sharePrefix}.allocator`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${sharePrefix}.cow`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${sharePrefix}.color`,
                    { type: 'string', role: 'text' }, null);
            }
        }

        // Update share values - only for shares we're tracking
        for (const share of shares) {
            const s = share as Record<string, unknown>;
            const name = s.name as string | null;
            if (!name) continue;

            // Only update if we're still tracking this share
            if (!this.shareNames.has(name)) {
                continue;
            }

            const sharePrefix = `shares.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.setStateAsync(`${sharePrefix}.name`,
                { val: name, ack: true });
            await this.setStateAsync(`${sharePrefix}.freeGb`,
                { val: this.kilobytesToGigabytes(s.free), ack: true });
            await this.setStateAsync(`${sharePrefix}.usedGb`,
                { val: this.kilobytesToGigabytes(s.used), ack: true });
            await this.setStateAsync(`${sharePrefix}.sizeGb`,
                { val: this.kilobytesToGigabytes(s.size), ack: true });

            // Calculate usage percent (used / (used + free))
            const usedKb = this.toNumberOrNull(s.used);
            const freeKb = this.toNumberOrNull(s.free);
            let usedPercent: number | null = null;
            if (usedKb !== null && freeKb !== null && (usedKb + freeKb) > 0) {
                usedPercent = Math.round((usedKb / (usedKb + freeKb)) * 10000) / 100;
            }
            await this.setStateAsync(`${sharePrefix}.usedPercent`,
                { val: usedPercent, ack: true });

            await this.setStateAsync(`${sharePrefix}.comment`,
                { val: this.toStringOrNull(s.comment), ack: true });
            await this.setStateAsync(`${sharePrefix}.allocator`,
                { val: this.toStringOrNull(s.allocator), ack: true });
            await this.setStateAsync(`${sharePrefix}.cow`,
                { val: this.toStringOrNull(s.cow), ack: true });
            await this.setStateAsync(`${sharePrefix}.color`,
                { val: this.toStringOrNull(s.color), ack: true });
        }
    }

    private async handleDynamicVms(data: QueryResult): Promise<void> {
        // Only process VMs if vms.list is selected
        if (!this.effectiveSelection.has('vms.list')) {
            return;
        }

        const vms = data.vms as { domains?: unknown[] };
        if (!vms?.domains) {
            return;
        }

        const domains = Array.isArray(vms.domains) ? vms.domains : [];
        const vmUuids = new Set<string>();

        for (const vm of domains) {
            const v = vm as Record<string, unknown>;
            const uuid = v.uuid as string | null;
            if (uuid) {
                vmUuids.add(uuid);
            }
        }

        // Check if we need to create new VM states
        const needsUpdate = !this.vmsDetected ||
            vmUuids.size !== this.vmUuids.size ||
            ![...vmUuids].every(uuid => this.vmUuids.has(uuid));

        if (needsUpdate) {
            this.vmUuids = vmUuids;
            this.vmsDetected = true;

            this.log.info(`Detected ${vmUuids.size} VMs`);

            // Create VM count state
            await this.writeState('vms.count',
                { type: 'number', role: 'value', unit: '' }, vmUuids.size);

            // Create states for each VM
            for (const vm of domains) {
                const v = vm as Record<string, unknown>;
                const name = v.name as string | null;
                const uuid = v.uuid as string | null;
                if (!name || !uuid) continue;

                const vmPrefix = `vms.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.writeState(`${vmPrefix}.name`,
                    { type: 'string', role: 'text' }, null);
                await this.writeState(`${vmPrefix}.state`,
                    { type: 'string', role: 'indicator.status' }, null);
                await this.writeState(`${vmPrefix}.uuid`,
                    { type: 'string', role: 'text' }, null);
            }
        }

        // Update VM values - only for VMs we're tracking
        for (const vm of domains) {
            const v = vm as Record<string, unknown>;
            const name = v.name as string | null;
            const uuid = v.uuid as string | null;
            if (!name || !uuid) continue;

            // Only update if we're still tracking this VM
            if (!this.vmUuids.has(uuid)) {
                continue;
            }

            const vmPrefix = `vms.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.setStateAsync(`${vmPrefix}.name`,
                { val: name, ack: true });
            await this.setStateAsync(`${vmPrefix}.state`,
                { val: this.toStringOrNull(v.state), ack: true });
            await this.setStateAsync(`${vmPrefix}.uuid`,
                { val: uuid, ack: true });
        }
    }

    private bigIntToNumber(value: unknown): number | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'bigint') {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        }
        return this.toNumberOrNull(value);
    }

    private toStringOrNull(value: unknown): string | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        return null;
    }

    private toBooleanOrNull(value: unknown): boolean | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        return null;
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
            // Clear the poll timer immediately
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = undefined;
            }

            // Stop subscriptions if active (fire and forget)
            if (this.subscriptionManager) {
                this.subscriptionManager.stop()
                    .catch((error) => {
                        this.log.warn(`Failed to stop subscriptions: ${this.describeError(error)}`);
                    });
                this.subscriptionManager = undefined;
            }

            // Dispose Apollo client (fire and forget)
            if (this.apolloClient) {
                this.apolloClient.dispose()
                    .catch((error) => {
                        this.log.warn(`Failed to dispose Apollo client: ${this.describeError(error)}`);
                    });
                this.apolloClient = undefined;
            }

            this.log.debug('Adapter cleanup initiated');
        } catch (error) {
            this.log.error(`Error during adapter cleanup: ${this.describeError(error)}`);
        }

        // Call callback immediately to signal we're done
        callback();
    }
}

if (module.parent) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new UnraidAdapter(options);
} else {
    (() => new UnraidAdapter())();
}
