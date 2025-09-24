import type { AdapterInterface } from '../types/adapter-types';
import type { UnraidApolloClient } from '../apollo-client';
import {
    DOCKER_START_MUTATION,
    DOCKER_STOP_MUTATION,
    VM_START_MUTATION,
    VM_STOP_MUTATION,
    VM_PAUSE_MUTATION,
    VM_RESUME_MUTATION,
    VM_FORCE_STOP_MUTATION,
    VM_REBOOT_MUTATION,
    VM_RESET_MUTATION,
} from '../graphql/mutations';

/**
 * Manages control operations for Docker containers and VMs
 * Handles button state changes and executes GraphQL mutations
 */
export class ControlManager {
    /**
     * Create a new control manager
     *
     * @param adapter - Adapter interface for logging and state management
     * @param apolloClient - Apollo client for GraphQL mutations
     */
    constructor(
        private readonly adapter: AdapterInterface,
        private readonly apolloClient: UnraidApolloClient,
    ) {}

    /**
     * Handle state changes for control buttons
     *
     * @param id - State ID that changed
     * @param state - New state value
     */
    async handleStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        // Ignore acknowledged states, deletions, or false values
        if (!state || state.ack || !state.val) {
            return;
        }

        // Check if this is a control button
        if (!id.includes('.commands.')) {
            return;
        }

        this.adapter.log.info(`Processing control action for ${id}`);

        try {
            await this.executeControlAction(id);
            await this.resetButton(id);
        } catch (error) {
            this.adapter.log.error(`Failed to execute control action: ${this.describeError(error)}`);
            await this.resetButton(id);
        }
    }

    /**
     * Execute the control action based on the button pressed
     *
     * @param stateId - The control button state ID
     */
    private async executeControlAction(stateId: string): Promise<void> {
        const obj = await this.adapter.getObjectAsync(stateId);
        if (!obj || !obj.native) {
            throw new Error(`No object found for control state ${stateId}`);
        }

        const { resourceType, resourceId, action } = obj.native as {
            resourceType: string;
            resourceId: string;
            action: string;
        };

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
    private async executeDockerAction(containerId: string, action: string): Promise<void> {
        this.adapter.log.info(`Executing Docker action: ${action} on container ${containerId}`);

        switch (action) {
            case 'start': {
                const startResult = await this.apolloClient.mutate(DOCKER_START_MUTATION, { id: containerId });
                this.adapter.log.debug(`Docker start mutation result: ${JSON.stringify(startResult)}`);
                break;
            }

            case 'stop': {
                const stopResult = await this.apolloClient.mutate(DOCKER_STOP_MUTATION, { id: containerId });
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
    private async executeVmAction(vmId: string, action: string): Promise<void> {
        this.adapter.log.info(`Executing VM action: ${action} on VM ${vmId}`);

        switch (action) {
            case 'start': {
                const startResult = await this.apolloClient.mutate(VM_START_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM start mutation result: ${JSON.stringify(startResult)}`);
                break;
            }

            case 'stop': {
                const stopResult = await this.apolloClient.mutate(VM_STOP_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM stop mutation result: ${JSON.stringify(stopResult)}`);
                break;
            }

            case 'pause': {
                const pauseResult = await this.apolloClient.mutate(VM_PAUSE_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM pause mutation result: ${JSON.stringify(pauseResult)}`);
                break;
            }

            case 'resume': {
                const resumeResult = await this.apolloClient.mutate(VM_RESUME_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM resume mutation result: ${JSON.stringify(resumeResult)}`);
                break;
            }

            case 'forceStop': {
                const forceStopResult = await this.apolloClient.mutate(VM_FORCE_STOP_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM forceStop mutation result: ${JSON.stringify(forceStopResult)}`);
                break;
            }

            case 'reboot': {
                const rebootResult = await this.apolloClient.mutate(VM_REBOOT_MUTATION, { id: vmId });
                this.adapter.log.debug(`VM reboot mutation result: ${JSON.stringify(rebootResult)}`);
                break;
            }

            case 'reset': {
                const resetResult = await this.apolloClient.mutate(VM_RESET_MUTATION, { id: vmId });
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
    private async resetButton(stateId: string): Promise<void> {
        await this.adapter.setStateAsync(stateId, { val: false, ack: true });
    }

    /**
     * Convert error to string for logging
     *
     * @param error - Error to describe
     * @returns Error message string
     */
    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
