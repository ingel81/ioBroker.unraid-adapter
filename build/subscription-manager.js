"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionManager = void 0;
/**
 * Manages GraphQL subscriptions for real-time Unraid metrics.
 * Handles automatic reconnection and update throttling.
 */
class SubscriptionManager {
    /** Apollo client for GraphQL operations */
    apolloClient;
    /** Map of active subscriptions by name */
    subscriptions = new Map();
    /** Callback to update ioBroker states */
    onStateUpdate;
    /** Error handler callback */
    onError;
    /** Connection lost callback */
    onConnectionLost;
    /** Connection restored callback */
    onConnectionRestored;
    /** Timer for reconnection attempts */
    reconnectTimer;
    /** Current connection status */
    isConnected = false;
    /** Map tracking last update time for each metric */
    lastUpdateTimes = new Map();
    /** Minimum time between updates for the same metric (milliseconds) */
    UPDATE_THROTTLE_MS = 1000; // Throttle updates to max 1 per second per metric
    /**
     * Creates a new subscription manager instance
     *
     * @param options - Configuration options for the manager
     */
    constructor(options) {
        this.apolloClient = options.apolloClient;
        this.onStateUpdate = options.onStateUpdate;
        this.onError = options.onError;
        this.onConnectionLost = options.onConnectionLost;
        this.onConnectionRestored = options.onConnectionRestored;
    }
    /**
     * Start all available subscriptions for Unraid metrics.
     * Automatically discovers available subscriptions via introspection.
     *
     * @returns Promise resolving to true if at least one subscription started successfully
     */
    async start() {
        try {
            // First, try to introspect to see what subscriptions are available
            const subscriptionInfo = await this.apolloClient.introspectSubscriptions();
            // Check if subscriptionInfo has the expected structure
            const subInfo = subscriptionInfo;
            if (!subInfo || !subInfo.fields) {
                console.log('No subscriptions available from Unraid GraphQL API');
                return false;
            }
            console.log('Available subscriptions:', subInfo.fields.map(f => f.name));
            // Try to subscribe to all available Unraid subscriptions
            const hasCpu = subInfo.fields.some(f => f.name === 'systemMetricsCpu');
            const hasMemory = subInfo.fields.some(f => f.name === 'systemMetricsMemory');
            const hasArray = subInfo.fields.some(f => f.name === 'arraySubscription');
            const hasNotifications = subInfo.fields.some(f => f.name === 'notificationAdded');
            const hasUps = subInfo.fields.some(f => f.name === 'upsUpdates');
            const hasServers = subInfo.fields.some(f => f.name === 'serversSubscription');
            // Subscribe to system metrics
            if (hasCpu) {
                this.subscribeToCpu();
            }
            if (hasMemory) {
                this.subscribeToMemory();
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
                this.subscribeToServers();
            }
            if (this.subscriptions.size > 0) {
                this.isConnected = true;
                this.onConnectionRestored?.();
                return true;
            }
            return false;
        }
        catch (error) {
            this.handleError(error);
            return false;
        }
    }
    /**
     * Subscribe to CPU metrics updates.
     * Receives real-time CPU usage percentage.
     *
     * @returns Promise that resolves when subscription is created
     */
    subscribeToCpu() {
        const subscription = this.apolloClient.subscribe(`
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
            error: error => this.handleError(error),
            complete: () => this.handleComplete('cpu'),
        });
        this.subscriptions.set('cpu', sub);
        console.log('Subscribed to CPU updates');
    }
    /**
     * Subscribe to memory metrics updates.
     * Receives real-time memory usage data including total, used, free, and percentage.
     *
     * @returns Promise that resolves when subscription is created
     */
    subscribeToMemory() {
        const subscription = this.apolloClient.subscribe(`
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
            error: error => this.handleError(error),
            complete: () => this.handleComplete('memory'),
        });
        this.subscriptions.set('memory', sub);
        console.log('Subscribed to Memory updates');
    }
    /**
     * Subscribe to array status updates.
     * Receives real-time disk array status including disk health, parity, and capacity.
     * Note: Currently broken in Unraid API (returns null despite being non-nullable).
     *
     * @returns Promise that resolves when subscription is created
     */
    subscribeToArray() {
        const subscription = this.apolloClient.subscribe(`
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
            error: error => this.handleError(error),
            complete: () => this.handleComplete('array'),
        });
        this.subscriptions.set('array', sub);
        console.log('Subscribed to array status updates');
    }
    /**
     * Subscribe to server status updates.
     * Receives real-time server status including IP addresses and URLs.
     *
     * @returns Promise that resolves when subscription is created
     */
    subscribeToServers() {
        const subscription = this.apolloClient.subscribe(`
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
            error: error => this.handleError(error),
            complete: () => this.handleComplete('servers'),
        });
        this.subscriptions.set('servers', sub);
        console.log('Subscribed to server status updates');
    }
    /**
     * Handle incoming CPU metric updates with throttling.
     * Updates the ioBroker state if throttle time has passed.
     *
     * @param cpu - CPU metrics object containing usage percentage
     * @returns Promise that resolves when state is updated
     */
    async handleCpuUpdate(cpu) {
        if (this.shouldUpdate('cpu.percentTotal')) {
            await this.onStateUpdate('metrics.cpu.percentTotal', cpu.percentTotal);
        }
    }
    /**
     * Handle incoming memory metric updates with throttling.
     * Converts bytes to GB and updates multiple ioBroker states.
     *
     * @param memory - Memory metrics object containing usage data
     * @returns Promise that resolves when all states are updated
     */
    async handleMemoryUpdate(memory) {
        const updates = [];
        if (memory.percentTotal !== undefined && this.shouldUpdate('memory.percentTotal')) {
            updates.push({ id: 'metrics.memory.percentTotal', value: memory.percentTotal });
        }
        if (memory.total !== undefined && this.shouldUpdate('memory.total')) {
            // Convert bytes to GB
            const totalGb = memory.total / (1024 * 1024 * 1024);
            updates.push({ id: 'metrics.memory.totalGb', value: totalGb });
        }
        if (memory.used !== undefined && this.shouldUpdate('memory.used')) {
            // Convert bytes to GB
            const usedGb = memory.used / (1024 * 1024 * 1024);
            updates.push({ id: 'metrics.memory.usedGb', value: usedGb });
        }
        if (memory.free !== undefined && this.shouldUpdate('memory.free')) {
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
     *
     * @param metricId - Unique identifier for the metric
     * @returns Promise resolving to true if update should proceed
     */
    shouldUpdate(metricId) {
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
     *
     * @param error - The error that occurred in the subscription
     */
    handleError(error) {
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
     *
     * @param subscriptionName - Name of the completed subscription
     */
    handleComplete(subscriptionName) {
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
    scheduleReconnect() {
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
     *
     * @returns Promise that resolves when all subscriptions are stopped
     */
    stop() {
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
     *
     * @returns True if connected and has active subscriptions
     */
    isActive() {
        return this.isConnected && this.subscriptions.size > 0;
    }
    /**
     * Get list of currently active subscription names.
     *
     * @returns Array of subscription names (e.g., ['cpu', 'memory', 'servers'])
     */
    getActiveSubscriptions() {
        return Array.from(this.subscriptions.keys());
    }
}
exports.SubscriptionManager = SubscriptionManager;
//# sourceMappingURL=subscription-manager.js.map