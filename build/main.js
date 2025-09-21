"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const apollo_client_1 = require("./apollo-client");
const subscription_manager_1 = require("./subscription-manager");
const unraid_domains_1 = require("./shared/unraid-domains");
class GraphQLSelectionBuilder {
    roots = new Map();
    addSelections(selections) {
        for (const selection of selections) {
            if (!selection.fields.length) {
                continue;
            }
            const rootNode = this.getOrCreateRoot(selection.root);
            this.addFields(rootNode, selection.fields);
        }
    }
    build() {
        if (!this.roots.size) {
            return null;
        }
        const sections = [];
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
    getOrCreateRoot(root) {
        const existing = this.roots.get(root);
        if (existing) {
            return existing;
        }
        const node = new Map();
        this.roots.set(root, node);
        return node;
    }
    addFields(target, fields) {
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
    printNode(node, indent) {
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
class UnraidAdapter extends adapter_core_1.Adapter {
    pollIntervalMs = 60000;
    pollTimer;
    stopRequested = false;
    apolloClient;
    subscriptionManager;
    useSubscriptions = false;
    subscriptionsActive = false;
    rawSelection = new Set();
    effectiveSelection = new Set();
    selectedDefinitions = [];
    staticObjectIds = new Set();
    createdChannels = new Set();
    createdStates = new Set();
    // Dynamic CPU core tracking
    cpuCoresDetected = false;
    cpuCoreCount = 0;
    constructor(options = {}) {
        super({
            ...options,
            name: 'unraid',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }
    async onReady() {
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
            this.apolloClient = new apollo_client_1.UnraidApolloClient({
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
        }
        catch (error) {
            this.log.error(`Failed to initialise adapter: ${this.describeError(error)}`);
        }
    }
    configureSelection(enabledDomains) {
        this.rawSelection = new Set(enabledDomains);
        this.effectiveSelection = (0, unraid_domains_1.expandSelection)(this.rawSelection);
        const definitions = [];
        for (const id of this.effectiveSelection) {
            const definition = unraid_domains_1.domainDefinitionById.get(id);
            if (definition) {
                definitions.push(definition);
            }
        }
        this.selectedDefinitions = definitions;
        this.staticObjectIds = this.collectStaticObjectIds(definitions);
    }
    collectStaticObjectIds(definitions) {
        const ids = new Set();
        const addPrefixes = (identifier) => {
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
    async initializeSubscriptions() {
        try {
            this.log.info('Initializing subscriptions...');
            if (!this.apolloClient) {
                throw new Error('Apollo client not initialized');
            }
            this.subscriptionManager = new subscription_manager_1.SubscriptionManager({
                apolloClient: this.apolloClient,
                onStateUpdate: async (id, value) => {
                    // Convert value to proper format and write state
                    const normalizedValue = value === undefined ? null : value;
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
            }
            else {
                this.log.warn('Subscriptions not available, using polling for all metrics');
            }
        }
        catch (error) {
            this.log.error(`Failed to initialize subscriptions: ${this.describeError(error)}`);
            this.log.info('Falling back to polling for all metrics');
        }
    }
    validateSettings() {
        const baseUrl = (this.config.baseUrl ?? '').trim();
        const apiToken = (this.config.apiToken ?? '').trim();
        const pollIntervalSecondsRaw = Number(this.config.pollIntervalSeconds ?? 60);
        const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : 60;
        const allowSelfSigned = Boolean(this.config.allowSelfSigned);
        const useSubscriptions = Boolean(this.config.useSubscriptions);
        const enabledDomainsRaw = Array.isArray(this.config.enabledDomains)
            ? this.config.enabledDomains
            : [...unraid_domains_1.defaultEnabledDomains];
        const knownIds = new Set(unraid_domains_1.allDomainIds);
        const enabledDomains = [];
        for (const id of enabledDomainsRaw) {
            if (knownIds.has(id)) {
                enabledDomains.push(id);
            }
        }
        if (!enabledDomains.length) {
            enabledDomains.push(...unraid_domains_1.defaultEnabledDomains);
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
    scheduleNextPoll() {
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
    async pollOnce() {
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
            const data = await this.apolloClient.query(query);
            this.logGraphQLResponse(data);
            await this.applyData(data);
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`GraphQL error: ${error.message}`);
            }
            throw error;
        }
    }
    buildQuery(definitions) {
        const builder = new GraphQLSelectionBuilder();
        for (const definition of definitions) {
            builder.addSelections(definition.selection);
        }
        return builder.build();
    }
    async applyData(data) {
        // Check for CPU cores and create states dynamically if needed
        await this.handleDynamicCpuCores(data);
        for (const definition of this.selectedDefinitions) {
            await this.applyDefinition(definition, data);
        }
    }
    async initializeStaticStates(definitions) {
        for (const definition of definitions) {
            for (const mapping of definition.states) {
                await this.writeState(mapping.id, mapping.common, null);
            }
        }
    }
    async handleDynamicCpuCores(data) {
        // Only process CPU cores if metrics.cpu is selected and data is available
        const metrics = data.metrics;
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
            await this.writeState('metrics.cpu.cores.count', { type: 'number', role: 'value', unit: '' }, coreCount);
            // Create states for each CPU core
            for (let i = 0; i < coreCount; i++) {
                const corePrefix = `metrics.cpu.cores.${i}`;
                // Create states for this core
                await this.writeState(`${corePrefix}.percentTotal`, { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentUser`, { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentSystem`, { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentNice`, { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentIdle`, { type: 'number', role: 'value.percent', unit: '%' }, null);
                await this.writeState(`${corePrefix}.percentIrq`, { type: 'number', role: 'value.percent', unit: '%' }, null);
            }
        }
        // Update CPU core values
        for (let i = 0; i < cores.length; i++) {
            const core = cores[i];
            const corePrefix = `metrics.cpu.cores.${i}`;
            await this.setStateAsync(`${corePrefix}.percentTotal`, { val: this.toNumberOrNull(core.percentTotal), ack: true });
            await this.setStateAsync(`${corePrefix}.percentUser`, { val: this.toNumberOrNull(core.percentUser), ack: true });
            await this.setStateAsync(`${corePrefix}.percentSystem`, { val: this.toNumberOrNull(core.percentSystem), ack: true });
            await this.setStateAsync(`${corePrefix}.percentNice`, { val: this.toNumberOrNull(core.percentNice), ack: true });
            await this.setStateAsync(`${corePrefix}.percentIdle`, { val: this.toNumberOrNull(core.percentIdle), ack: true });
            await this.setStateAsync(`${corePrefix}.percentIrq`, { val: this.toNumberOrNull(core.percentIrq), ack: true });
        }
    }
    toNumberOrNull(value) {
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
    async applyDefinition(definition, data) {
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
    resolveValue(source, path) {
        let current = source;
        for (const segment of path) {
            if (!current || typeof current !== 'object') {
                return null;
            }
            current = current[segment];
        }
        return current === undefined ? null : current;
    }
    async cleanupObjectTree(allowedIds) {
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
                }
                catch (error) {
                    this.log.warn(`Failed to remove object ${relativeId}: ${this.describeError(error)}`);
                }
            }
        }
        this.createdChannels.clear();
        this.createdStates.clear();
    }
    shouldKeepObject(objectId, allowedIds) {
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
    async ensureChannelHierarchy(id) {
        const parts = id.split('.');
        for (let index = 1; index < parts.length; index += 1) {
            const channelId = parts.slice(0, index).join('.');
            if (this.createdChannels.has(channelId)) {
                continue;
            }
            const labelKey = unraid_domains_1.domainNodeById.get(channelId)?.label ?? channelId;
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
    async writeState(id, common, value) {
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
        const normalizedValue = value === undefined ? null : value;
        await this.setStateAsync(id, { val: normalizedValue, ack: true });
    }
    logGraphQLResponse(data) {
        try {
            const serialized = JSON.stringify(data);
            const maxLength = 3000;
            const output = serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
            this.log.debug(`GraphQL response: ${output}`);
        }
        catch (error) {
            this.log.debug(`GraphQL response received but could not be stringified: ${this.describeError(error)}`);
        }
    }
    onStateChange(id, state) {
        if (state) {
            this.log.debug(`State ${id} changed: ${state.val} (ack=${state.ack})`);
        }
    }
    describeError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
    onUnload(callback) {
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
        }
        finally {
            callback();
        }
    }
}
if (module.parent) {
    module.exports = (options) => new UnraidAdapter(options);
}
else {
    (() => new UnraidAdapter())();
}
//# sourceMappingURL=main.js.map