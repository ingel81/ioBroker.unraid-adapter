/**
 * GraphQL mutation definitions for control operations
 * Based on Unraid API schema from docs/schema.graphql
 */

// Docker mutations - return DockerContainer object
export const DOCKER_START_MUTATION = `
    mutation StartDockerContainer($id: PrefixedID!) {
        docker {
            start(id: $id) {
                id
                state
                status
            }
        }
    }
`;

export const DOCKER_STOP_MUTATION = `
    mutation StopDockerContainer($id: PrefixedID!) {
        docker {
            stop(id: $id) {
                id
                state
                status
            }
        }
    }
`;

// VM mutations - all return Boolean!
export const VM_START_MUTATION = `
    mutation StartVM($id: PrefixedID!) {
        vm {
            start(id: $id)
        }
    }
`;

export const VM_STOP_MUTATION = `
    mutation StopVM($id: PrefixedID!) {
        vm {
            stop(id: $id)
        }
    }
`;

export const VM_PAUSE_MUTATION = `
    mutation PauseVM($id: PrefixedID!) {
        vm {
            pause(id: $id)
        }
    }
`;

export const VM_RESUME_MUTATION = `
    mutation ResumeVM($id: PrefixedID!) {
        vm {
            resume(id: $id)
        }
    }
`;

export const VM_FORCE_STOP_MUTATION = `
    mutation ForceStopVM($id: PrefixedID!) {
        vm {
            forceStop(id: $id)
        }
    }
`;

export const VM_REBOOT_MUTATION = `
    mutation RebootVM($id: PrefixedID!) {
        vm {
            reboot(id: $id)
        }
    }
`;

export const VM_RESET_MUTATION = `
    mutation ResetVM($id: PrefixedID!) {
        vm {
            reset(id: $id)
        }
    }
`;
