"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const graphql_client_1 = require("./graphql-client");
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
    client;
    rawSelection = new Set();
    effectiveSelection = new Set();
    selectedDefinitions = [];
    staticObjectIds = new Set();
    createdChannels = new Set();
    createdStates = new Set();
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
            this.client = new graphql_client_1.GraphQLClient({
                baseUrl: settings.baseUrl,
                token: settings.apiToken,
                allowSelfSigned: settings.allowSelfSigned,
            });
            this.pollIntervalMs = settings.pollIntervalSeconds * 1000;
            await this.cleanupObjectTree(this.staticObjectIds);
            await this.initializeStaticStates(this.selectedDefinitions);
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
    validateSettings() {
        const baseUrl = (this.config.baseUrl ?? '').trim();
        const apiToken = (this.config.apiToken ?? '').trim();
        const pollIntervalSecondsRaw = Number(this.config.pollIntervalSeconds ?? 60);
        const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : 60;
        const allowSelfSigned = Boolean(this.config.allowSelfSigned);
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
            const data = await this.client.query(query);
            this.logGraphQLResponse(data);
            await this.applyData(data);
        }
        catch (error) {
            if (error instanceof graphql_client_1.GraphQLHttpError) {
                throw new Error(`GraphQL HTTP error ${error.status}: ${error.body || error.message}`);
            }
            if (error instanceof graphql_client_1.GraphQLRequestError || error instanceof graphql_client_1.GraphQLResponseError) {
                throw new Error(error.message);
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
    async applyDefinition(definition, data) {
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
            if (this.client) {
                void this.client.dispose().catch((error) => {
                    this.log.warn(`Failed to dispose GraphQL client: ${this.describeError(error)}`);
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