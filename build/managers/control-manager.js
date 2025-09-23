"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlManager = void 0;
const mutations_1 = require("../graphql/mutations");
/**
 * Manages control operations for Docker containers and VMs
 * Handles button state changes and executes GraphQL mutations
 */
class ControlManager {
    adapter;
    apolloClient;
    /**
     * Create a new control manager
     *
     * @param adapter - Adapter interface for logging and state management
     * @param apolloClient - Apollo client for GraphQL mutations
     */
    constructor(adapter, apolloClient) {
        this.adapter = adapter;
        this.apolloClient = apolloClient;
    }
    /**
     * Handle state changes for control buttons
     *
     * @param id - State ID that changed
     * @param state - New state value
     */
    async handleStateChange(id, state) {
        // Ignore acknowledged states, deletions, or false values
        if (!state || state.ack || !state.val) {
            return;
        }
        // Check if this is a control button
        if (!id.includes('.controls.')) {
            return;
        }
        this.adapter.log.info(`Processing control action for ${id}`);
        try {
            await this.executeControlAction(id);
            await this.resetButton(id);
        }
        catch (error) {
            this.adapter.log.error(`Failed to execute control action: ${this.describeError(error)}`);
            await this.resetButton(id);
        }
    }
    /**
     * Execute the control action based on the button pressed
     *
     * @param stateId - The control button state ID
     */
    async executeControlAction(stateId) {
        const obj = await this.adapter.getObjectAsync(stateId);
        if (!obj || !obj.native) {
            throw new Error(`No object found for control state ${stateId}`);
        }
        const { resourceType, resourceId, action } = obj.native;
        this.adapter.log.info(`Executing ${action} for ${resourceType} ${resourceId}`);
        switch (resourceType) {
            case 'docker':
                await this.executeDockerAction(resourceId, action);
                break;
            case 'vm':
                await this.executeVmAction(resourceId, action);
                break;
            default:
                throw new Error(`Unknown resource type: ${resourceType}`);
        }
    }
    /**
     * Execute Docker container control actions
     *
     * @param containerId - Docker container ID (PrefixedID format)
     * @param action - Action to perform (start, stop)
     */
    async executeDockerAction(containerId, action) {
        this.adapter.log.info(`Executing Docker action: ${action} on container ${containerId}`);
        switch (action) {
            case 'start': {
                const startResult = await this.apolloClient.mutate(mutations_1.DOCKER_START_MUTATION, { id: containerId });
                this.adapter.log.debug(`Docker start mutation result: ${JSON.stringify(startResult)}`);
                break;
            }
            case 'stop': {
                const stopResult = await this.apolloClient.mutate(mutations_1.DOCKER_STOP_MUTATION, { id: containerId });
                this.adapter.log.debug(`Docker stop mutation result: ${JSON.stringify(stopResult)}`);
                break;
            }
            default:
                throw new Error(`Unknown Docker action: ${action}`);
        }
    }
    /**
     * Execute VM control actions
     *
     * @param vmId - Virtual machine ID (PrefixedID format)
     * @param action - Action to perform (start, stop, pause, resume, forceStop, reboot, reset)
     */
    async executeVmAction(vmId, action) {
        this.adapter.log.info(`Executing VM action: ${action} on VM ${vmId}`);
        switch (action) {
            case 'start': {
                const startResult = await this.apolloClient.mutate(mutations_1.VM_START_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM start mutation result: ${JSON.stringify(startResult)}`);
                break;
            }
            case 'stop': {
                const stopResult = await this.apolloClient.mutate(mutations_1.VM_STOP_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM stop mutation result: ${JSON.stringify(stopResult)}`);
                break;
            }
            case 'pause': {
                const pauseResult = await this.apolloClient.mutate(mutations_1.VM_PAUSE_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM pause mutation result: ${JSON.stringify(pauseResult)}`);
                break;
            }
            case 'resume': {
                const resumeResult = await this.apolloClient.mutate(mutations_1.VM_RESUME_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM resume mutation result: ${JSON.stringify(resumeResult)}`);
                break;
            }
            case 'forceStop': {
                const forceStopResult = await this.apolloClient.mutate(mutations_1.VM_FORCE_STOP_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM forceStop mutation result: ${JSON.stringify(forceStopResult)}`);
                break;
            }
            case 'reboot': {
                const rebootResult = await this.apolloClient.mutate(mutations_1.VM_REBOOT_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM reboot mutation result: ${JSON.stringify(rebootResult)}`);
                break;
            }
            case 'reset': {
                const resetResult = await this.apolloClient.mutate(mutations_1.VM_RESET_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM reset mutation result: ${JSON.stringify(resetResult)}`);
                break;
            }
            default:
                throw new Error(`Unknown VM action: ${action}`);
        }
    }
    /**
     * Reset button state back to false
     *
     * @param stateId - Button state ID to reset
     */
    async resetButton(stateId) {
        await this.adapter.setStateAsync(stateId, { val: false, ack: true });
    }
    /**
     * Convert error to string for logging
     *
     * @param error - Error to describe
     * @returns Error message string
     */
    describeError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.ControlManager = ControlManager;
//# sourceMappingURL=control-manager.js.map