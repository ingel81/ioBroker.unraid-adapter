import type { AdapterInterface } from '../types/adapter-types';
import type { DomainDefinition, StateMapping } from '../shared/unraid-domains';
import { resolveValue } from '../utils/data-transformers';
import stateTranslations from '../translations/state-names.json';

/**
 * Manages ioBroker state objects and their values
 */
export class StateManager {
    private readonly createdChannels = new Set<string>();
    private readonly createdStates = new Set<string>();

    /**
     * Create a new state manager
     *
     * @param adapter - Adapter interface for state operations
     */
    constructor(private readonly adapter: AdapterInterface) {}

    /**
     * Initialize static states from domain definitions
     *
     * @param definitions - Array of domain definitions to initialize states from
     */
    async initializeStaticStates(definitions: readonly DomainDefinition[]): Promise<void> {
        for (const definition of definitions) {
            for (const mapping of definition.states) {
                await this.writeState(mapping.id, mapping.common, null);
            }
        }
    }

    /**
     * Apply domain definition to query result data
     *
     * @param definition - Domain definition to apply
     * @param data - Query result data to process
     */
    async applyDefinition(definition: DomainDefinition, data: Record<string, unknown>): Promise<void> {
        // First check if this domain's data exists in the result
        const rootPath = definition.selection[0]?.root;
        if (!rootPath || !(rootPath in data)) {
            // Skip if this domain wasn't queried
            return;
        }

        for (const mapping of definition.states) {
            const rawValue = resolveValue(data, mapping.path);
            const transformed = mapping.transform ? mapping.transform(rawValue) : rawValue;
            await this.writeState(mapping.id, mapping.common, transformed);
        }
    }

    /**
     * Create or update a state with proper object hierarchy
     *
     * @param id - State ID
     * @param common - Common state properties
     * @param value - State value to set
     */
    async writeState(id: string, common: StateMapping['common'], value: unknown): Promise<void> {
        await this.ensureChannelHierarchy(id);

        // Get translation object or use id as fallback
        const translations = (stateTranslations as Record<string, any>)[id];
        const name: ioBroker.StringOrTranslated = translations || id;

        // Always update or create the state object to ensure translations are applied
        await this.adapter.setObjectAsync(id, {
            type: 'state',
            common: {
                name,
                role: common.role,
                type: common.type,
                unit: common.unit,
                read: true,
                write: false,
            },
            native: {},
        });
        this.createdStates.add(id);

        const normalizedValue = value === undefined ? null : (value as ioBroker.StateValue | null);
        await this.adapter.setStateAsync(id, normalizedValue, true);
    }

    /**
     * Update state value without creating object
     *
     * @param id - State ID
     * @param value - State value to set
     */
    async updateState(id: string, value: unknown): Promise<void> {
        const normalizedValue = value === undefined ? null : (value as ioBroker.StateValue | null);
        await this.adapter.setStateAsync(id, normalizedValue, true);
    }

    /**
     * Clean up the object tree by removing objects not in allowed set
     *
     * @param allowedIds - Set of allowed object IDs to keep
     */
    async cleanupObjectTree(allowedIds: Set<string>): Promise<void> {
        const objects = await this.adapter.getAdapterObjectsAsync();
        for (const fullId of Object.keys(objects)) {
            const relativeId = fullId.startsWith(`${this.adapter.namespace}.`)
                ? fullId.slice(this.adapter.namespace.length + 1)
                : fullId;

            if (!relativeId) {
                continue;
            }

            if (!this.shouldKeepObject(relativeId, allowedIds)) {
                try {
                    await this.adapter.delObjectAsync(relativeId, { recursive: true });
                } catch (error) {
                    this.adapter.log.warn(`Failed to remove object ${relativeId}: ${this.describeError(error)}`);
                }
            }
        }

        this.createdChannels.clear();
        this.createdStates.clear();
    }

    /**
     * Collect all static object IDs from domain definitions
     *
     * @param definitions - Array of domain definitions to collect IDs from
     */
    collectStaticObjectIds(definitions: readonly DomainDefinition[]): Set<string> {
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
     * Clear internal tracking sets
     */
    clear(): void {
        this.createdChannels.clear();
        this.createdStates.clear();
    }

    private shouldKeepObject(objectId: string, allowedIds: Set<string>): boolean {
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

    private async ensureChannelHierarchy(id: string): Promise<void> {
        const parts = id.split('.');
        for (let index = 1; index < parts.length; index += 1) {
            const channelId = parts.slice(0, index).join('.');

            // Try to get translation object, otherwise use channelId as fallback
            const translations = (stateTranslations as Record<string, any>)[channelId];
            let name: ioBroker.StringOrTranslated = translations || channelId;

            // For dynamic resources, use only the resource name as label (no translations)
            if (channelId.startsWith('docker.containers.') && index === 3) {
                // Extract the container name (last part of the channelId)
                name = parts[2];
            } else if (channelId.startsWith('shares.') && index === 2) {
                // Extract the share name
                name = parts[1];
            } else if (channelId.startsWith('vms.') && index === 2) {
                // Extract the VM name
                name = parts[1];
            } else if (channelId.startsWith('array.disks.') && index === 3) {
                // For array disks, show "Disk X" or parity/cache name
                name = `Disk ${parts[2]}`;
            } else if (channelId.startsWith('array.parities.') && index === 3) {
                name = `Parity ${parts[2]}`;
            } else if (channelId.startsWith('array.caches.') && index === 3) {
                name = `Cache ${parts[2]}`;
            } else if (channelId.startsWith('metrics.cpu.cores.') && index === 4) {
                name = `Core ${parts[3]}`;
            }

            // Always update the object to ensure the name is correct
            // This will create it if it doesn't exist, or update it if it does
            await this.adapter.setObjectAsync(channelId, {
                type: 'channel',
                common: {
                    name,
                },
                native: {},
            });

            this.createdChannels.add(channelId);
        }
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
