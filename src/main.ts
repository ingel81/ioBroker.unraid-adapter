import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';

import { UnraidApolloClient } from './apollo-client';
import { SubscriptionManager } from './subscription-manager';
import { StateManager } from './managers/state-manager';
import { DynamicResourceManager } from './managers/dynamic-resource-manager';
import { PollingManager } from './managers/polling-manager';
import { validateConfig, type AdapterConfig } from './config/adapter-config';
import {
    domainDefinitionById,
    expandSelection,
    type DomainDefinition,
    type DomainId,
} from './shared/unraid-domains';

/**
 * Main adapter class for connecting ioBroker to Unraid servers.
 * Manages GraphQL polling, WebSocket subscriptions, and state updates.
 */
class UnraidAdapter extends Adapter {
    private apolloClient?: UnraidApolloClient;
    private subscriptionManager?: SubscriptionManager;
    private stateManager?: StateManager;
    private dynamicResourceManager?: DynamicResourceManager;
    private pollingManager?: PollingManager;

    private unraidConfig?: AdapterConfig;
    private effectiveSelection: Set<DomainId> = new Set();
    private selectedDefinitions: DomainDefinition[] = [];
    private staticObjectIds: Set<string> = new Set();

    /**
     * Creates a new Unraid adapter instance
     * @param options - Adapter options from ioBroker
     */
    public constructor(options: Partial<AdapterOptions> = {}) {
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
    private async onReady(): Promise<void> {
        try {
            // Validate configuration
            const config = validateConfig(this.config, this.log);
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
            this.stateManager = new StateManager(this);
            this.dynamicResourceManager = new DynamicResourceManager(this, this.stateManager);

            // Initialize Apollo Client
            this.apolloClient = new UnraidApolloClient({
                baseUrl: config.baseUrl,
                apiToken: config.apiToken,
                allowSelfSigned: config.allowSelfSigned,
            });

            // Initialize polling manager
            this.pollingManager = new PollingManager(
                this,
                this.apolloClient,
                this.handlePolledData.bind(this)
            );

            // Clean up and initialize states
            await this.stateManager.cleanupObjectTree(this.staticObjectIds);
            await this.stateManager.initializeStaticStates(this.selectedDefinitions);

            // Subscription support disabled for now (API issues)
            // if (config.useSubscriptions) {
            //     await this.initializeSubscriptions();
            // }

            // Start polling
            this.pollingManager.start(config.pollIntervalSeconds * 1000, this.selectedDefinitions);
        } catch (error) {
            this.log.error(`Failed to initialise adapter: ${this.describeError(error)}`);
        }
    }

    /**
     * Configure which domains should be queried based on settings.
     * Expands the selection to include dependencies.
     * @param enabledDomains - List of explicitly enabled domain IDs
     */
    private configureSelection(enabledDomains: readonly DomainId[]): void {
        const rawSelection = new Set(enabledDomains);
        this.effectiveSelection = expandSelection(rawSelection);

        const definitions: DomainDefinition[] = [];
        for (const id of this.effectiveSelection) {
            const definition = domainDefinitionById.get(id);
            if (definition) {
                definitions.push(definition);
            }
        }
        this.selectedDefinitions = definitions;

        if (this.stateManager) {
            this.staticObjectIds = this.stateManager.collectStaticObjectIds(definitions);
        } else {
            // Fallback for initialization phase
            this.staticObjectIds = this.collectStaticObjectIdsTemp(definitions);
        }

        // Reset dynamic tracking for deselected domains
        this.dynamicResourceManager?.resetTracking(this.effectiveSelection);
    }

    /**
     * Temporary method for collecting static object IDs during initialization
     */
    private collectStaticObjectIdsTemp(definitions: readonly DomainDefinition[]): Set<string> {
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

    /**
     * Handle data received from polling
     * @param data - GraphQL query result data
     */
    private async handlePolledData(data: Record<string, unknown>): Promise<void> {
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
    private async initializeSubscriptions(): Promise<void> {
        try {
            this.log.info('Initializing subscriptions...');

            if (!this.apolloClient || !this.stateManager) {
                throw new Error('Apollo client or state manager not initialized');
            }

            this.subscriptionManager = new SubscriptionManager({
                apolloClient: this.apolloClient,
                onStateUpdate: async (id: string, value: unknown) => {
                    await this.stateManager!.updateState(id, value);
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
            } else {
                this.log.warn('Subscriptions not available, using polling for all metrics');
            }
        } catch (error) {
            this.log.error(`Failed to initialize subscriptions: ${this.describeError(error)}`);
            this.log.info('Falling back to polling for all metrics');
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