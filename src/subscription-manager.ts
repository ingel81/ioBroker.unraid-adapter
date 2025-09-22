import type { ObservableSubscription } from '@apollo/client/core';
import { UnraidApolloClient } from './apollo-client';

/**
 * Configuration options for the subscription manager
 */
export interface SubscriptionManagerOptions {
    /** Apollo client instance for GraphQL operations */
    apolloClient: UnraidApolloClient;
    /** Callback to update ioBroker state values */
    onStateUpdate: (id: string, value: unknown) => Promise<void>;
    /** Optional error handler for subscription errors */
    onError?: (error: Error) => void;
    /** Optional callback when WebSocket connection is lost */
    onConnectionLost?: () => void;
    /** Optional callback when WebSocket connection is restored */
    onConnectionRestored?: () => void;
}

/**
 * Manages GraphQL subscriptions for real-time Unraid metrics.
 * Handles automatic reconnection and update throttling.
 */
export class SubscriptionManager {
    /** Apollo client for GraphQL operations */
    private apolloClient: UnraidApolloClient;
    /** Map of active subscriptions by name */
    private subscriptions: Map<string, ObservableSubscription> = new Map();
    /** Callback to update ioBroker states */
    private onStateUpdate: (id: string, value: unknown) => Promise<void>;
    /** Error handler callback */
    private onError?: (error: Error) => void;
    /** Connection lost callback */
    private onConnectionLost?: () => void;
    /** Connection restored callback */
    private onConnectionRestored?: () => void;
    /** Timer for reconnection attempts */
    private reconnectTimer?: NodeJS.Timeout;
    /** Current connection status */
    private isConnected = false;
    /** Map tracking last update time for each metric */
    private lastUpdateTimes: Map<string, number> = new Map();
    /** Minimum time between updates for the same metric (milliseconds) */
    private readonly UPDATE_THROTTLE_MS = 1000; // Throttle updates to max 1 per second per metric

    /**
     * Creates a new subscription manager instance
     * @param options - Configuration options for the manager
     */
    constructor(options: SubscriptionManagerOptions) {
        this.apolloClient = options.apolloClient;
        this.onStateUpdate = options.onStateUpdate;
        this.onError = options.onError;
        this.onConnectionLost = options.onConnectionLost;
        this.onConnectionRestored = options.onConnectionRestored;
    }

    /**
     * Start all available subscriptions for Unraid metrics.
     * Automatically discovers available subscriptions via introspection.
     * @returns Promise resolving to true if at least one subscription started successfully
     */
    async start(): Promise<boolean> {
        try {
            // First, try to introspect to see what subscriptions are available
            const subscriptionInfo = await this.apolloClient.introspectSubscriptions();

            // Check if subscriptionInfo has the expected structure
            const subInfo = subscriptionInfo as { fields?: Array<{ name: string }> } | null;

            if (!subInfo || !subInfo.fields) {
                console.log('No subscriptions available from Unraid GraphQL API');
                return false;
            }

            console.log('Available subscriptions:', subInfo.fields.map((f) => f.name));

            // Try to subscribe to all available Unraid subscriptions
            const hasCpu = subInfo.fields.some((f) => f.name === 'systemMetricsCpu');
            const hasMemory = subInfo.fields.some((f) => f.name === 'systemMetricsMemory');
            const hasArray = subInfo.fields.some((f) => f.name === 'arraySubscription');
            const hasNotifications = subInfo.fields.some((f) => f.name === 'notificationAdded');
            const hasUps = subInfo.fields.some((f) => f.name === 'upsUpdates');
            const hasServers = subInfo.fields.some((f) => f.name === 'serversSubscription');

            // Subscribe to system metrics
            if (hasCpu) {
                await this.subscribeToCpu();
            }
            if (hasMemory) {
                await this.subscribeToMemory();
            }

            // Subscribe to array status
            if (hasArray) {
                console.log('Array subscription available - but BROKEN in Unraid API (always returns null)');
                // BUG: arraySubscription is broken in Unraid GraphQL API
                // It's defined as non-nullable but always returns null
                // Normal 'array' query works fine, so we need to use polling for array data
                // await this.subscribeToArray();
            }
            if (hasNotifications) {
                console.log('Notification subscription available - could subscribe to new notifications');
            }
            if (hasUps) {
                console.log('UPS subscription available - could subscribe to UPS status updates');
            }
            if (hasServers) {
                console.log('Servers subscription available - subscribing to server status');
                await this.subscribeToServers();
            }

            if (this.subscriptions.size > 0) {
                this.isConnected = true;
                this.onConnectionRestored?.();
                return true;
            }

            return false;
        } catch (error) {
            this.handleError(error as Error);
            return false;
        }
    }


    /**
     * Subscribe to CPU metrics updates.
     * Receives real-time CPU usage percentage.
     * @returns Promise that resolves when subscription is created
     */
    private async subscribeToCpu(): Promise<void> {
        const subscription = this.apolloClient.subscribe<{ systemMetricsCpu: { percentTotal?: number } }>(`
            subscription CpuSubscription {
                systemMetricsCpu {
                    percentTotal
                }
            }
        `);

        const sub = subscription.subscribe({
            next: async (result) => {
                if (result.data?.systemMetricsCpu) {
                    await this.handleCpuUpdate(result.data.systemMetricsCpu);
                }
            },
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('cpu')
        });

        this.subscriptions.set('cpu', sub);
        console.log('Subscribed to CPU updates');
    }

    /**
     * Subscribe to memory metrics updates.
     * Receives real-time memory usage data including total, used, free, and percentage.
     * @returns Promise that resolves when subscription is created
     */
    private async subscribeToMemory(): Promise<void> {
        const subscription = this.apolloClient.subscribe<{ systemMetricsMemory: { percentTotal?: number; total?: number; used?: number; free?: number } }>(`
            subscription MemorySubscription {
                systemMetricsMemory {
                    percentTotal
                    total
                    used
                    free
                }
            }
        `);

        const sub = subscription.subscribe({
            next: async (result) => {
                if (result.data?.systemMetricsMemory) {
                    await this.handleMemoryUpdate(result.data.systemMetricsMemory);
                }
            },
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('memory')
        });

        this.subscriptions.set('memory', sub);
        console.log('Subscribed to Memory updates');
    }

    /**
     * Subscribe to array status updates.
     * Receives real-time disk array status including disk health, parity, and capacity.
     * Note: Currently broken in Unraid API (returns null despite being non-nullable).
     * @returns Promise that resolves when subscription is created
     */
    private async subscribeToArray(): Promise<void> {
        const subscription = this.apolloClient.subscribe<{ arraySubscription: unknown }>(`
            subscription ArraySubscription {
                arraySubscription {
                    id
                    state
                    capacity {
                        kilobytes {
                            free
                            used
                            total
                        }
                    }
                    boot {
                        id
                        name
                        device
                        status
                        temp
                        fsSize
                        fsFree
                        fsUsed
                        numErrors
                    }
                    parities {
                        id
                        name
                        device
                        status
                        temp
                        size
                        fsUsed
                        numErrors
                        isSpinning
                    }
                    parityCheckStatus {
                        status
                        progress
                        speed
                        errors
                        running
                        paused
                        correcting
                        date
                        duration
                    }
                    disks {
                        id
                        idx
                        name
                        device
                        status
                        temp
                        size
                        fsSize
                        fsFree
                        fsUsed
                        numReads
                        numWrites
                        numErrors
                        isSpinning
                        color
                    }
                    caches {
                        id
                        name
                        device
                        status
                        temp
                        size
                        fsSize
                        fsFree
                        fsUsed
                        numErrors
                        isSpinning
                    }
                }
            }
        `);

        const sub = subscription.subscribe({
            next: async (result) => {
                console.log('Array subscription update:', JSON.stringify(result.data, null, 2));
                // TODO: Process array updates - could update disk states, parity status, etc.
            },
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('array')
        });

        this.subscriptions.set('array', sub);
        console.log('Subscribed to array status updates');
    }

    /**
     * Subscribe to server status updates.
     * Receives real-time server status including IP addresses and URLs.
     * @returns Promise that resolves when subscription is created
     */
    private async subscribeToServers(): Promise<void> {
        const subscription = this.apolloClient.subscribe<{ serversSubscription: unknown }>(`
            subscription ServersSubscription {
                serversSubscription {
                    name
                    status
                    lanip
                    wanip
                    localurl
                    remoteurl
                }
            }
        `);

        const sub = subscription.subscribe({
            next: async (result) => {
                console.log('Server subscription update:', JSON.stringify(result.data, null, 2));
                // TODO: Process server updates
            },
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('servers')
        });

        this.subscriptions.set('servers', sub);
        console.log('Subscribed to server status updates');
    }


    /**
     * Handle incoming CPU metric updates with throttling.
     * Updates the ioBroker state if throttle time has passed.
     * @param cpu - CPU metrics object containing usage percentage
     * @returns Promise that resolves when state is updated
     */
    private async handleCpuUpdate(cpu: { percentTotal?: number }): Promise<void> {
        if (await this.shouldUpdate('cpu.percentTotal')) {
            await this.onStateUpdate('metrics.cpu.percentTotal', cpu.percentTotal);
        }
    }

    /**
     * Handle incoming memory metric updates with throttling.
     * Converts bytes to GB and updates multiple ioBroker states.
     * @param memory - Memory metrics object containing usage data
     * @returns Promise that resolves when all states are updated
     */
    private async handleMemoryUpdate(memory: { percentTotal?: number; total?: number; used?: number; free?: number }): Promise<void> {
        const updates: Array<{ id: string; value: unknown }> = [];

        if (memory.percentTotal !== undefined && await this.shouldUpdate('memory.percentTotal')) {
            updates.push({ id: 'metrics.memory.percentTotal', value: memory.percentTotal });
        }
        if (memory.total !== undefined && await this.shouldUpdate('memory.total')) {
            // Convert bytes to GB
            const totalGb = memory.total / (1024 * 1024 * 1024);
            updates.push({ id: 'metrics.memory.totalGb', value: totalGb });
        }
        if (memory.used !== undefined && await this.shouldUpdate('memory.used')) {
            // Convert bytes to GB
            const usedGb = memory.used / (1024 * 1024 * 1024);
            updates.push({ id: 'metrics.memory.usedGb', value: usedGb });
        }
        if (memory.free !== undefined && await this.shouldUpdate('memory.free')) {
            // Convert bytes to GB
            const freeGb = memory.free / (1024 * 1024 * 1024);
            updates.push({ id: 'metrics.memory.freeGb', value: freeGb });
        }

        // Execute all updates
        for (const update of updates) {
            await this.onStateUpdate(update.id, update.value);
        }
    }

    /**
     * Check if a metric should be updated based on throttling rules.
     * Prevents excessive updates by enforcing minimum time between updates.
     * @param metricId - Unique identifier for the metric
     * @returns Promise resolving to true if update should proceed
     */
    private async shouldUpdate(metricId: string): Promise<boolean> {
        const now = Date.now();
        const lastUpdate = this.lastUpdateTimes.get(metricId);

        if (!lastUpdate || now - lastUpdate >= this.UPDATE_THROTTLE_MS) {
            this.lastUpdateTimes.set(metricId, now);
            return true;
        }

        return false;
    }

    /**
     * Handle subscription errors and trigger reconnection.
     * Notifies callbacks and schedules automatic reconnection attempt.
     * @param error - The error that occurred in the subscription
     */
    private handleError(error: Error): void {
        console.error('Subscription error:', error);
        this.onError?.(error);

        if (this.isConnected) {
            this.isConnected = false;
            this.onConnectionLost?.();
        }

        // Attempt to reconnect after 5 seconds
        this.scheduleReconnect();
    }

    /**
     * Handle subscription completion event.
     * Removes subscription from active list and triggers reconnection if needed.
     * @param subscriptionName - Name of the completed subscription
     */
    private handleComplete(subscriptionName: string): void {
        console.log(`Subscription ${subscriptionName} completed`);
        this.subscriptions.delete(subscriptionName);

        if (this.subscriptions.size === 0 && this.isConnected) {
            this.isConnected = false;
            this.onConnectionLost?.();
            this.scheduleReconnect();
        }
    }

    /**
     * Schedule an automatic reconnection attempt.
     * Retries connection after 5 seconds, with continuous retry on failure.
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(async () => {
            console.log('Attempting to reconnect subscriptions...');
            const success = await this.start();
            if (!success) {
                // If reconnection failed, try again
                this.scheduleReconnect();
            }
        }, 5000);
    }

    /**
     * Stop all active subscriptions and clear internal state.
     * Cancels any pending reconnection attempts.
     * @returns Promise that resolves when all subscriptions are stopped
     */
    async stop(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        for (const [name, subscription] of this.subscriptions) {
            subscription.unsubscribe();
            console.log(`Unsubscribed from ${name}`);
        }

        this.subscriptions.clear();
        this.lastUpdateTimes.clear();
        this.isConnected = false;
    }

    /**
     * Check if the subscription manager has active subscriptions.
     * @returns True if connected and has active subscriptions
     */
    isActive(): boolean {
        return this.isConnected && this.subscriptions.size > 0;
    }

    /**
     * Get list of currently active subscription names.
     * @returns Array of subscription names (e.g., ['cpu', 'memory', 'servers'])
     */
    getActiveSubscriptions(): string[] {
        return Array.from(this.subscriptions.keys());
    }
}