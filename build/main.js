"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const apollo_client_1 = require("./apollo-client");
const subscription_manager_1 = require("./subscription-manager");
const state_manager_1 = require("./managers/state-manager");
const dynamic_resource_manager_1 = require("./managers/dynamic-resource-manager");
const polling_manager_1 = require("./managers/polling-manager");
const adapter_config_1 = require("./config/adapter-config");
const unraid_domains_1 = require("./shared/unraid-domains");
/**
 * Main adapter class for connecting ioBroker to Unraid servers.
 * Manages GraphQL polling, WebSocket subscriptions, and state updates.
 */
class UnraidAdapter extends adapter_core_1.Adapter {
    apolloClient;
    subscriptionManager;
    stateManager;
    dynamicResourceManager;
    pollingManager;
    unraidConfig;
    effectiveSelection = new Set();
    selectedDefinitions = [];
    staticObjectIds = new Set();
    /**
     * Creates a new Unraid adapter instance
     * @param options - Adapter options from ioBroker
     */
    constructor(options = {}) {
        super({
            ...options,
            name: 'unraid',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }
    /**
     * Called when the adapter is ready to start.
     * Initializes connections and starts polling.
     */
    async onReady() {
        try {
            // Validate configuration
            const config = (0, adapter_config_1.validateConfig)(this.config, this.log);
            if (!config) {
                this.log.warn('Adapter is idle because the configuration is incomplete.');
                return;
            }
            this.unraidConfig = config;
            // Configure domain selection
            this.configureSelection(config.enabledDomains);
            if (!this.selectedDefinitions.length) {
                this.log.warn('No domains selected. Configure at least one domain in the adapter settings.');
                return;
            }
            // Initialize managers
            this.stateManager = new state_manager_1.StateManager(this);
            this.dynamicResourceManager = new dynamic_resource_manager_1.DynamicResourceManager(this, this.stateManager);
            // Initialize Apollo Client
            this.apolloClient = new apollo_client_1.UnraidApolloClient({
                baseUrl: config.baseUrl,
                apiToken: config.apiToken,
                allowSelfSigned: config.allowSelfSigned,
            });
            // Initialize polling manager
            this.pollingManager = new polling_manager_1.PollingManager(this, this.apolloClient, this.handlePolledData.bind(this));
            // Clean up and initialize states
            await this.stateManager.cleanupObjectTree(this.staticObjectIds);
            await this.stateManager.initializeStaticStates(this.selectedDefinitions);
            // Subscription support disabled for now (API issues)
            // if (config.useSubscriptions) {
            //     await this.initializeSubscriptions();
            // }
            // Start polling
            this.pollingManager.start(config.pollIntervalSeconds * 1000, this.selectedDefinitions);
        }
        catch (error) {
            this.log.error(`Failed to initialise adapter: ${this.describeError(error)}`);
        }
    }
    /**
     * Configure which domains should be queried based on settings.
     * Expands the selection to include dependencies.
     * @param enabledDomains - List of explicitly enabled domain IDs
     */
    configureSelection(enabledDomains) {
        const rawSelection = new Set(enabledDomains);
        this.effectiveSelection = (0, unraid_domains_1.expandSelection)(rawSelection);
        const definitions = [];
        for (const id of this.effectiveSelection) {
            const definition = unraid_domains_1.domainDefinitionById.get(id);
            if (definition) {
                definitions.push(definition);
            }
        }
        this.selectedDefinitions = definitions;
        if (this.stateManager) {
            this.staticObjectIds = this.stateManager.collectStaticObjectIds(definitions);
        }
        else {
            // Fallback for initialization phase
            this.staticObjectIds = this.collectStaticObjectIdsTemp(definitions);
        }
        // Reset dynamic tracking for deselected domains
        this.dynamicResourceManager?.resetTracking(this.effectiveSelection);
    }
    /**
     * Temporary method for collecting static object IDs during initialization
     */
    collectStaticObjectIdsTemp(definitions) {
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
    /**
     * Handle data received from polling
     * @param data - GraphQL query result data
     */
    async handlePolledData(data) {
        if (!this.stateManager || !this.dynamicResourceManager) {
            this.log.error('Managers not initialized');
            return;
        }
        // Handle dynamic resources
        await this.dynamicResourceManager.handleDynamicCpuCores(data, this.effectiveSelection);
        await this.dynamicResourceManager.handleDynamicArrayDisks(data, this.effectiveSelection);
        await this.dynamicResourceManager.handleDynamicDockerContainers(data, this.effectiveSelection);
        await this.dynamicResourceManager.handleDynamicShares(data, this.effectiveSelection);
        await this.dynamicResourceManager.handleDynamicVms(data, this.effectiveSelection);
        // Apply static definitions
        for (const definition of this.selectedDefinitions) {
            await this.stateManager.applyDefinition(definition, data);
        }
    }
    /**
     * Initialize WebSocket subscriptions for real-time metrics.
     * Falls back to polling if subscriptions are not available.
     */
    async initializeSubscriptions() {
        try {
            this.log.info('Initializing subscriptions...');
            if (!this.apolloClient || !this.stateManager) {
                throw new Error('Apollo client or state manager not initialized');
            }
            this.subscriptionManager = new subscription_manager_1.SubscriptionManager({
                apolloClient: this.apolloClient,
                onStateUpdate: async (id, value) => {
                    await this.stateManager.updateState(id, value);
                },
                onError: (error) => {
                    this.log.warn(`Subscription error: ${error.message}`);
                },
                onConnectionLost: () => {
                    this.log.warn('WebSocket connection lost, falling back to polling for CPU/Memory');
                },
                onConnectionRestored: () => {
                    this.log.info('WebSocket connection restored, using subscriptions for CPU/Memory');
                },
            });
            const success = await this.subscriptionManager.start();
            if (success) {
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
        try {
            // Stop polling
            this.pollingManager?.stop();
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
            // Clear managers
            this.stateManager?.clear();
            this.stateManager = undefined;
            this.dynamicResourceManager = undefined;
            this.pollingManager = undefined;
            this.log.debug('Adapter cleanup completed');
        }
        catch (error) {
            this.log.error(`Error during adapter cleanup: ${this.describeError(error)}`);
        }
        // Call callback immediately to signal we're done
        callback();
    }
}
if (module.parent) {
    module.exports = (options) => new UnraidAdapter(options);
}
else {
    (() => new UnraidAdapter())();
}
//# sourceMappingURL=main.js.map