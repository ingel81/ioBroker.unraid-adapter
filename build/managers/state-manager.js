"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateManager = void 0;
const unraid_domains_1 = require("../shared/unraid-domains");
const data_transformers_1 = require("../utils/data-transformers");
/**
 * Manages ioBroker state objects and their values
 */
class StateManager {
    adapter;
    createdChannels = new Set();
    createdStates = new Set();
    /**
     * Create a new state manager
     *
     * @param adapter - Adapter interface for state operations
     */
    constructor(adapter) {
        this.adapter = adapter;
    }
    /**
     * Initialize static states from domain definitions
     *
     * @param definitions - Array of domain definitions to initialize states from
     */
    async initializeStaticStates(definitions) {
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
    async applyDefinition(definition, data) {
        // First check if this domain's data exists in the result
        const rootPath = definition.selection[0]?.root;
        if (!rootPath || !(rootPath in data)) {
            // Skip if this domain wasn't queried
            return;
        }
        for (const mapping of definition.states) {
            const rawValue = (0, data_transformers_1.resolveValue)(data, mapping.path);
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
    async writeState(id, common, value) {
        await this.ensureChannelHierarchy(id);
        if (!this.createdStates.has(id)) {
            await this.adapter.setObjectNotExistsAsync(id, {
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
        await this.adapter.setStateAsync(id, normalizedValue, true);
    }
    /**
     * Update state value without creating object
     *
     * @param id - State ID
     * @param value - State value to set
     */
    async updateState(id, value) {
        const normalizedValue = value === undefined ? null : value;
        await this.adapter.setStateAsync(id, normalizedValue, true);
    }
    /**
     * Clean up the object tree by removing objects not in allowed set
     *
     * @param allowedIds - Set of allowed object IDs to keep
     */
    async cleanupObjectTree(allowedIds) {
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
                }
                catch (error) {
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
    /**
     * Clear internal tracking sets
     */
    clear() {
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
            let labelKey = unraid_domains_1.domainNodeById.get(channelId)?.label ?? channelId;
            // For dynamic resources, use only the resource name as label
            if (channelId.startsWith('docker.containers.') && index === 3) {
                // Extract the container name (last part of the channelId)
                labelKey = parts[2];
            }
            else if (channelId.startsWith('shares.') && index === 2) {
                // Extract the share name
                labelKey = parts[1];
            }
            else if (channelId.startsWith('vms.') && index === 2) {
                // Extract the VM name
                labelKey = parts[1];
            }
            else if (channelId.startsWith('array.disks.') && index === 3) {
                // For array disks, show "Disk X" or parity/cache name
                labelKey = `Disk ${parts[2]}`;
            }
            else if (channelId.startsWith('array.parities.') && index === 3) {
                labelKey = `Parity ${parts[2]}`;
            }
            else if (channelId.startsWith('array.caches.') && index === 3) {
                labelKey = `Cache ${parts[2]}`;
            }
            else if (channelId.startsWith('metrics.cpu.cores.') && index === 4) {
                labelKey = `Core ${parts[3]}`;
            }
            // Always update the object to ensure the name is correct
            // This will create it if it doesn't exist, or update it if it does
            await this.adapter.setObjectAsync(channelId, {
                type: 'channel',
                common: {
                    name: labelKey,
                },
                native: {},
            });
            this.createdChannels.add(channelId);
        }
    }
    describeError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.StateManager = StateManager;
//# sourceMappingURL=state-manager.js.map