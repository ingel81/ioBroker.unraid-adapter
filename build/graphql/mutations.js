"use strict";
/**
 * GraphQL mutation definitions for control operations
 * Based on Unraid API schema from docs/schema.graphql
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VM_RESET_MUTATION = exports.VM_REBOOT_MUTATION = exports.VM_FORCE_STOP_MUTATION = exports.VM_RESUME_MUTATION = exports.VM_PAUSE_MUTATION = exports.VM_STOP_MUTATION = exports.VM_START_MUTATION = exports.DOCKER_STOP_MUTATION = exports.DOCKER_START_MUTATION = void 0;
// Docker mutations - return DockerContainer object
exports.DOCKER_START_MUTATION = `
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
exports.DOCKER_STOP_MUTATION = `
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
exports.VM_START_MUTATION = `
    mutation StartVM($id: PrefixedID!) {
        vm {
            start(id: $id)
        }
    }
`;
exports.VM_STOP_MUTATION = `
    mutation StopVM($id: PrefixedID!) {
        vm {
            stop(id: $id)
        }
    }
`;
exports.VM_PAUSE_MUTATION = `
    mutation PauseVM($id: PrefixedID!) {
        vm {
            pause(id: $id)
        }
    }
`;
exports.VM_RESUME_MUTATION = `
    mutation ResumeVM($id: PrefixedID!) {
        vm {
            resume(id: $id)
        }
    }
`;
exports.VM_FORCE_STOP_MUTATION = `
    mutation ForceStopVM($id: PrefixedID!) {
        vm {
            forceStop(id: $id)
        }
    }
`;
exports.VM_REBOOT_MUTATION = `
    mutation RebootVM($id: PrefixedID!) {
        vm {
            reboot(id: $id)
        }
    }
`;
exports.VM_RESET_MUTATION = `
    mutation ResetVM($id: PrefixedID!) {
        vm {
            reset(id: $id)
        }
    }
`;
//# sourceMappingURL=mutations.js.map