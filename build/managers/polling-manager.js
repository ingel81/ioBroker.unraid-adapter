"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollingManager = void 0;
const selection_builder_1 = require("../graphql/selection-builder");
/**
 * Manages polling cycles and GraphQL queries
 */
class PollingManager {
    adapter;
    apolloClient;
    onDataReceived;
    pollTimer;
    stopRequested = false;
    currentDefinitions = [];
    /**
     * Create a new polling manager
     *
     * @param adapter - Adapter interface for logging and timers
     * @param apolloClient - Apollo client for GraphQL queries
     * @param onDataReceived - Callback function when data is received
     */
    constructor(adapter, apolloClient, onDataReceived) {
        this.adapter = adapter;
        this.apolloClient = apolloClient;
        this.onDataReceived = onDataReceived;
    }
    /**
     * Start polling with the given interval
     *
     * @param pollIntervalMs - Polling interval in milliseconds
     * @param definitions - Array of domain definitions to poll
     */
    start(pollIntervalMs, definitions) {
        if (this.stopRequested) {
            return;
        }
        this.currentDefinitions = definitions;
        // Execute first poll immediately
        void this.pollOnce(definitions)
            .catch(error => {
            this.adapter.log.error(`Initial polling failed: ${this.describeError(error)}`);
        })
            .finally(() => {
            this.scheduleNextPoll(pollIntervalMs, definitions);
        });
    }
    /**
     * Trigger a manual poll (e.g., after a control action)
     */
    poll() {
        if (this.currentDefinitions.length === 0) {
            this.adapter.log.debug('Cannot poll - no definitions available');
            return;
        }
        void this.pollOnce(this.currentDefinitions).catch(error => {
            this.adapter.log.error(`Manual polling failed: ${this.describeError(error)}`);
        });
    }
    /**
     * Stop polling
     */
    stop() {
        this.stopRequested = true;
        if (this.pollTimer) {
            this.adapter.clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    /**
     * Execute a single polling cycle
     *
     * @param definitions - Array of domain definitions to poll
     */
    async pollOnce(definitions) {
        if (!definitions.length) {
            this.adapter.log.debug('Skipping poll because no domains are selected.');
            return;
        }
        const query = this.buildQuery(definitions);
        if (!query) {
            this.adapter.log.warn('No query could be built for the current selection.');
            return;
        }
        try {
            const data = await this.apolloClient.query(query);
            this.logGraphQLResponse(data);
            await this.onDataReceived(data);
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`GraphQL error: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Schedule the next polling cycle
     *
     * @param pollIntervalMs - Polling interval in milliseconds
     * @param definitions - Array of domain definitions to poll
     */
    scheduleNextPoll(pollIntervalMs, definitions) {
        if (this.stopRequested) {
            return;
        }
        this.pollTimer = this.adapter.setTimeout(() => {
            void this.pollOnce(definitions)
                .catch(error => {
                this.adapter.log.error(`Polling failed: ${this.describeError(error)}`);
            })
                .finally(() => {
                this.scheduleNextPoll(pollIntervalMs, definitions);
            });
        }, pollIntervalMs);
    }
    /**
     * Build a GraphQL query from domain definitions
     *
     * @param definitions - Array of domain definitions to build query from
     */
    buildQuery(definitions) {
        const builder = new selection_builder_1.GraphQLSelectionBuilder();
        for (const definition of definitions) {
            builder.addSelections(definition.selection);
        }
        return builder.build();
    }
    /**
     * Log GraphQL response for debugging
     *
     * @param data - GraphQL response data to log
     */
    logGraphQLResponse(data) {
        try {
            const serialized = JSON.stringify(data);
            const maxLength = 3000;
            const output = serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
            this.adapter.log.debug(`GraphQL response: ${output}`);
        }
        catch (error) {
            this.adapter.log.debug(`GraphQL response received but could not be stringified: ${this.describeError(error)}`);
        }
    }
    /**
     * Convert error to string description
     *
     * @param error - Error to describe
     */
    describeError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.PollingManager = PollingManager;
//# sourceMappingURL=polling-manager.js.map