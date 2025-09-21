"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionManager = void 0;
class SubscriptionManager {
    apolloClient;
    subscriptions = new Map();
    onStateUpdate;
    onError;
    onConnectionLost;
    onConnectionRestored;
    reconnectTimer;
    isConnected = false;
    lastUpdateTimes = new Map();
    UPDATE_THROTTLE_MS = 1000; // Throttle updates to max 1 per second per metric
    constructor(options) {
        this.apolloClient = options.apolloClient;
        this.onStateUpdate = options.onStateUpdate;
        this.onError = options.onError;
        this.onConnectionLost = options.onConnectionLost;
        this.onConnectionRestored = options.onConnectionRestored;
    }
    /**
     * Start subscriptions for CPU and Memory metrics
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
        }
        catch (error) {
            this.handleError(error);
            return false;
        }
    }
    /**
     * Subscribe to CPU metrics only
     */
    async subscribeToCpu() {
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
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('cpu')
        });
        this.subscriptions.set('cpu', sub);
        console.log('Subscribed to CPU updates');
    }
    /**
     * Subscribe to Memory metrics only
     */
    async subscribeToMemory() {
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
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('memory')
        });
        this.subscriptions.set('memory', sub);
        console.log('Subscribed to Memory updates');
    }
    /**
     * Subscribe to Array status updates
     */
    async subscribeToArray() {
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
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('array')
        });
        this.subscriptions.set('array', sub);
        console.log('Subscribed to array status updates');
    }
    /**
     * Subscribe to Server status updates
     */
    async subscribeToServers() {
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
            error: (error) => this.handleError(error),
            complete: () => this.handleComplete('servers')
        });
        this.subscriptions.set('servers', sub);
        console.log('Subscribed to server status updates');
    }
    /**
     * Handle CPU update with throttling
     */
    async handleCpuUpdate(cpu) {
        if (await this.shouldUpdate('cpu.percentTotal')) {
            await this.onStateUpdate('metrics.cpu.percentTotal', cpu.percentTotal);
        }
    }
    /**
     * Handle Memory update with throttling
     */
    async handleMemoryUpdate(memory) {
        const updates = [];
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
     * Check if we should update a metric (throttling)
     */
    async shouldUpdate(metricId) {
        const now = Date.now();
        const lastUpdate = this.lastUpdateTimes.get(metricId);
        if (!lastUpdate || now - lastUpdate >= this.UPDATE_THROTTLE_MS) {
            this.lastUpdateTimes.set(metricId, now);
            return true;
        }
        return false;
    }
    /**
     * Handle subscription error
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
     * Handle subscription completion
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
     * Schedule a reconnection attempt
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
     * Stop all subscriptions
     */
    async stop() {
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
     * Check if subscriptions are active
     */
    isActive() {
        return this.isConnected && this.subscriptions.size > 0;
    }
    /**
     * Get list of active subscription names
     */
    getActiveSubscriptions() {
        return Array.from(this.subscriptions.keys());
    }
}
exports.SubscriptionManager = SubscriptionManager;
//# sourceMappingURL=subscription-manager.js.map