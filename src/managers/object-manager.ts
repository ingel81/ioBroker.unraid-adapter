import type { AdapterInterface } from '../types/adapter-types';
import type { DomainDefinition, DomainId } from '../shared/unraid-domains';
import type { StateManager } from './state-manager';

interface TrackedObject {
    id: string;
    type: 'channel' | 'state';
    lastSeen: number;
    isStatic: boolean;
    resourceType?: 'cpu' | 'disk' | 'docker' | 'share' | 'vm';
    resourceId?: string;
}

/**
 * Manages ioBroker object lifecycle - creation, tracking, and cleanup.
 * Ensures the object structure stays in sync with the Unraid server state.
 */
export class ObjectManager {
    private trackedObjects = new Map<string, TrackedObject>();
    private currentPollTimestamp = 0;
    private staticObjectIds = new Set<string>();

    /**
     * Create a new ObjectManager
     *
     * @param adapter - Adapter interface
     * @param _stateManager - State manager instance (unused, kept for compatibility)
     */
    constructor(
        private readonly adapter: AdapterInterface,
        private readonly _stateManager: StateManager,
    ) {}

    /**
     * Initialize object tracking with static definitions
     *
     * @param definitions - Domain definitions to initialize with
     */
    async initialize(definitions: readonly DomainDefinition[]): Promise<void> {
        this.staticObjectIds = this.collectStaticObjectIds(definitions);
        this.currentPollTimestamp = Date.now();

        // Track all existing objects
        await this.syncExistingObjects();

        // Fix channel names for existing objects
        await this.fixExistingChannelNames();
    }

    /**
     * Start a new polling cycle
     */
    beginPollCycle(): void {
        this.currentPollTimestamp = Date.now();
    }

    /**
     * Mark an object as seen in current poll cycle
     *
     * @param id - The object ID
     * @param type - The object type (channel or state)
     * @param resourceType - The resource type (optional)
     * @param resourceId - The resource ID (optional)
     */
    markObjectSeen(id: string, type: 'channel' | 'state', resourceType?: string, resourceId?: string): void {
        const existing = this.trackedObjects.get(id);
        if (existing) {
            existing.lastSeen = this.currentPollTimestamp;
        } else {
            this.trackedObjects.set(id, {
                id,
                type,
                lastSeen: this.currentPollTimestamp,
                isStatic: this.staticObjectIds.has(id),
                resourceType: resourceType as any,
                resourceId,
            });
        }
    }

    /**
     * Clean up objects that haven't been seen recently
     * NOTE: This method is deprecated and does nothing
     *
     * @param _gracePeriodMs - Grace period in milliseconds (unused)
     */
    cleanupStaleObjects(_gracePeriodMs: number = 60000): void {
        // This method is deprecated and does nothing now
        // Cleanup is handled by:
        // 1. cleanupUnselectedDomains() at startup for unselected domains
        // 2. handleDynamicResources() during runtime for removed resources
        this.adapter.log.debug('cleanupStaleObjects called but is deprecated - cleanup handled elsewhere');
    }

    /**
     * Handle dynamic resources found in current poll
     *
     * @param resourceType - The type of resource being handled
     * @param currentResources - Map of current resources found in poll
     */
    async handleDynamicResources(
        resourceType: 'cpu' | 'disk' | 'docker' | 'share' | 'vm',
        currentResources: Map<string, any>,
    ): Promise<void> {
        const resourcePrefix = this.getResourcePrefix(resourceType);

        // Track which resource IDs we've seen
        const seenResourceIds = new Set<string>();

        for (const [resourceId] of currentResources) {
            seenResourceIds.add(resourceId);
        }

        // Find resources that no longer exist
        const toRemove: string[] = [];
        for (const [, obj] of this.trackedObjects) {
            if (obj.resourceType === resourceType && obj.resourceId && !seenResourceIds.has(obj.resourceId)) {
                // This resource no longer exists
                toRemove.push(obj.resourceId);
            }
        }

        // Remove objects for resources that no longer exist
        for (const resourceId of toRemove) {
            const objectPrefix = `${resourcePrefix}.${resourceId}`;
            this.adapter.log.info(`Resource ${resourceType}/${resourceId} no longer exists, removing objects`);

            try {
                await this.adapter.delObjectAsync(objectPrefix, { recursive: true });

                // Remove from tracking
                const toDelete: string[] = [];
                for (const [id, obj] of this.trackedObjects) {
                    if (obj.resourceType === resourceType && obj.resourceId === resourceId) {
                        toDelete.push(id);
                    }
                }
                for (const id of toDelete) {
                    this.trackedObjects.delete(id);
                }
            } catch (error) {
                this.adapter.log.warn(`Failed to remove objects for ${objectPrefix}: ${this.describeError(error)}`);
            }
        }
    }

    /**
     * Clean up all objects not in the selected domains
     *
     * @param selectedDomains - Set of selected domain IDs to keep
     */
    async cleanupUnselectedDomains(selectedDomains: Set<DomainId>): Promise<void> {
        const objects = await this.adapter.getAdapterObjectsAsync();
        const allowedPrefixes = this.getAllowedPrefixes(selectedDomains);

        for (const fullId of Object.keys(objects)) {
            const relativeId = this.getRelativeId(fullId);
            if (!relativeId) {
                continue;
            }

            // Check if this object belongs to a selected domain
            let shouldKeep = false;
            for (const prefix of allowedPrefixes) {
                if (relativeId.startsWith(prefix)) {
                    shouldKeep = true;
                    break;
                }
            }

            if (!shouldKeep) {
                try {
                    await this.adapter.delObjectAsync(relativeId, { recursive: true });
                    this.trackedObjects.delete(relativeId);
                    this.adapter.log.debug(`Removed object from unselected domain: ${relativeId}`);
                } catch (error) {
                    this.adapter.log.warn(`Failed to remove object ${relativeId}: ${this.describeError(error)}`);
                }
            }
        }
    }

    /**
     * Get tracking statistics
     */
    getStatistics(): { total: number; static: number; dynamic: number; byType: Record<string, number> } {
        const stats = {
            total: this.trackedObjects.size,
            static: 0,
            dynamic: 0,
            byType: {} as Record<string, number>,
        };

        for (const obj of this.trackedObjects.values()) {
            if (obj.isStatic) {
                stats.static++;
            } else {
                stats.dynamic++;
            }

            if (obj.resourceType) {
                stats.byType[obj.resourceType] = (stats.byType[obj.resourceType] || 0) + 1;
            }
        }

        return stats;
    }

    private async syncExistingObjects(): Promise<void> {
        const objects = await this.adapter.getAdapterObjectsAsync();

        for (const fullId of Object.keys(objects)) {
            const relativeId = this.getRelativeId(fullId);
            if (!relativeId) {
                continue;
            }

            const obj = objects[fullId];
            this.trackedObjects.set(relativeId, {
                id: relativeId,
                type: obj.type as 'channel' | 'state',
                lastSeen: this.currentPollTimestamp,
                isStatic: this.staticObjectIds.has(relativeId),
            });
        }

        this.adapter.log.debug(`Synchronized ${this.trackedObjects.size} existing objects`);
    }

    private async fixExistingChannelNames(): Promise<void> {
        const objects = await this.adapter.getAdapterObjectsAsync();
        let updatedCount = 0;
        let checkedCount = 0;

        for (const fullId of Object.keys(objects)) {
            const relativeId = this.getRelativeId(fullId);
            if (!relativeId) {
                continue;
            }

            const obj = objects[fullId];
            if (obj.type !== 'channel') {
                continue;
            }

            const parts = relativeId.split('.');
            let newName: string | null = null;

            // Determine the correct name for dynamic resource channels
            if (relativeId.startsWith('docker.containers.') && parts.length === 3) {
                // Extract the container name
                newName = parts[2];
                checkedCount++;
            } else if (relativeId.startsWith('shares.') && parts.length === 2) {
                // Extract the share name
                newName = parts[1];
                checkedCount++;
            } else if (relativeId.startsWith('vms.') && parts.length === 2) {
                // Extract the VM name
                newName = parts[1];
                checkedCount++;
            } else if (relativeId.startsWith('array.disks.') && parts.length === 3) {
                newName = `Disk ${parts[2]}`;
                checkedCount++;
            } else if (relativeId.startsWith('array.parities.') && parts.length === 3) {
                newName = `Parity ${parts[2]}`;
                checkedCount++;
            } else if (relativeId.startsWith('array.caches.') && parts.length === 3) {
                newName = `Cache ${parts[2]}`;
                checkedCount++;
            } else if (relativeId.startsWith('metrics.cpu.cores.') && parts.length === 4) {
                newName = `Core ${parts[3]}`;
                checkedCount++;
            }

            // Update the channel name if it's different
            if (newName && obj.common?.name !== newName) {
                // Use setObject to update the name
                const updatedObj = {
                    ...obj,
                    common: {
                        ...obj.common,
                        name: newName,
                    },
                };
                await this.adapter.setObjectAsync(relativeId, updatedObj);
                updatedCount++;
                this.adapter.log.debug(`Updated channel name for ${relativeId} to "${newName}"`);
            }
        }

        if (checkedCount > 0) {
            if (updatedCount > 0) {
                this.adapter.log.info(`Fixed ${updatedCount} of ${checkedCount} dynamic channel names`);
            } else {
                this.adapter.log.debug(`All ${checkedCount} dynamic channel names are correct`);
            }
        }
    }

    private getRelativeId(fullId: string): string | null {
        const prefix = `${this.adapter.namespace}.`;
        if (fullId.startsWith(prefix)) {
            return fullId.slice(prefix.length);
        }
        return null;
    }

    private getResourcePrefix(resourceType: 'cpu' | 'disk' | 'docker' | 'share' | 'vm'): string {
        switch (resourceType) {
            case 'cpu':
                return 'metrics.cpu.cores';
            case 'disk':
                return 'array.disks';
            case 'docker':
                return 'docker.containers';
            case 'share':
                return 'shares';
            case 'vm':
                return 'vms';
        }
    }

    private getAllowedPrefixes(selectedDomains: Set<DomainId>): string[] {
        const prefixes: string[] = [];

        for (const domain of selectedDomains) {
            // Add the domain itself and common parent paths
            const parts = domain.split('.');
            for (let i = 1; i <= parts.length; i++) {
                const prefix = parts.slice(0, i).join('.');
                if (!prefixes.includes(prefix)) {
                    prefixes.push(prefix);
                }
            }
        }

        return prefixes;
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

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
