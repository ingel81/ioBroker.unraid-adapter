import type { AdapterInterface } from '../types/adapter-types';
import type { UnraidApolloClient } from '../apollo-client';
import type { DomainDefinition } from '../shared/unraid-domains';
import { GraphQLSelectionBuilder } from '../graphql/selection-builder';

/**
 * Manages polling cycles and GraphQL queries
 */
export class PollingManager {
    private pollTimer?: ioBroker.Timeout;
    private stopRequested = false;
    private currentDefinitions: readonly DomainDefinition[] = [];

    /**
     * Create a new polling manager
     *
     * @param adapter - Adapter interface for logging and timers
     * @param apolloClient - Apollo client for GraphQL queries
     * @param onDataReceived - Callback function when data is received
     */
    constructor(
        private readonly adapter: AdapterInterface,
        private readonly apolloClient: UnraidApolloClient,
        private readonly onDataReceived: (data: Record<string, unknown>) => Promise<void>,
    ) {}

    /**
     * Start polling with the given interval
     *
     * @param pollIntervalMs - Polling interval in milliseconds
     * @param definitions - Array of domain definitions to poll
     */
    start(pollIntervalMs: number, definitions: readonly DomainDefinition[]): void {
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
    poll(): void {
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
    stop(): void {
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
    private async pollOnce(definitions: readonly DomainDefinition[]): Promise<void> {
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
            const data = await this.apolloClient.query<Record<string, unknown>>(query);
            this.logGraphQLResponse(data);
            await this.onDataReceived(data);
        } catch (error) {
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
    private scheduleNextPoll(pollIntervalMs: number, definitions: readonly DomainDefinition[]): void {
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
    private buildQuery(definitions: readonly DomainDefinition[]): string | null {
        const builder = new GraphQLSelectionBuilder();
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
    private logGraphQLResponse(data: Record<string, unknown>): void {
        try {
            const serialized = JSON.stringify(data);
            const maxLength = 3000;
            const output = serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
            this.adapter.log.debug(`GraphQL response: ${output}`);
        } catch (error) {
            this.adapter.log.debug(
                `GraphQL response received but could not be stringified: ${this.describeError(error)}`,
            );
        }
    }

    /**
     * Convert error to string description
     *
     * @param error - Error to describe
     */
    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
