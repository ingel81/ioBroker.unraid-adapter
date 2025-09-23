# Unraid Control Implementation Plan

## Executive Summary

This document outlines the comprehensive implementation plan for adding control capabilities to the ioBroker Unraid adapter. The implementation will enable users to start, stop, and manage Docker containers and virtual machines directly through ioBroker using Unraid's GraphQL mutation API.

## Architecture Overview

### Design Principles

1. **Separation of Concerns**: Control states (buttons) are separate from monitoring states (readonly)
2. **Stateless Actions**: Buttons trigger actions without maintaining state
3. **GraphQL Mutations**: All control operations use Unraid's native GraphQL API
4. **User Feedback**: Actions provide clear feedback through state acknowledgment
5. **Safety First**: Graceful shutdown options alongside force stop operations

### Technology Stack

- **GraphQL Mutations**: Unraid API for control operations
- **Apollo Client**: Existing client extended for mutations
- **ioBroker Buttons**: Standard button pattern with `role: button`
- **TypeScript**: Type-safe implementation throughout

## Object Tree Structure

### Current Structure (Readonly)
```
unraid.0/
├── docker/
│   └── containers/
│       └── [container_name]/
│           ├── name           # Container name
│           ├── image          # Docker image
│           ├── state          # RUNNING/EXITED
│           ├── status         # Status text
│           ├── autoStart      # Auto-start enabled
│           └── sizeGb         # Root filesystem size
└── vms/
    └── [vm_name]/
        ├── name               # VM name
        ├── state              # RUNNING/SHUTOFF
        └── uuid               # VM UUID
```

### New Control States Structure
```
unraid.0/
├── docker/
│   └── containers/
│       └── [container_name]/
│           ├── ... (existing readonly states)
│           ├── controls/
│           │   ├── start     # button: Start container
│           │   ├── stop      # button: Stop container
│           │   └── restart   # button: Restart container
└── vms/
    └── [vm_name]/
        ├── ... (existing readonly states)
        ├── controls/
        │   ├── start         # button: Start VM
        │   ├── stop          # button: Force stop VM
        │   └── shutdown      # button: Graceful shutdown
```

## Button State Configuration

### State Object Definition
```typescript
interface ControlButtonState {
  _id: string;
  type: 'state';
  common: {
    name: string | MultilingualName;
    type: 'boolean';
    role: 'button' | 'button.start' | 'button.stop';
    read: true;
    write: true;
    def: false;
    desc?: string;
  };
  native: {
    containerId?: string;  // For Docker containers
    vmId?: string;         // For VMs
    action: 'start' | 'stop' | 'restart' | 'shutdown';
  };
}
```

### Button Behavior Pattern
1. **Initial State**: Button value is `false`
2. **User Click**: Value set to `true` with `ack: false`
3. **Adapter Processing**: Executes mutation
4. **Completion**: Adapter sets value back to `false` with `ack: true`
5. **Error Handling**: Log error, reset button, optionally set error state

## GraphQL Mutations

### Docker Container Mutations

#### Start Container
```graphql
mutation StartContainer($id: PrefixedID!) {
  docker {
    start(id: $id) {
      id
      state
      status
    }
  }
}
```

#### Stop Container
```graphql
mutation StopContainer($id: PrefixedID!) {
  docker {
    stop(id: $id) {
      id
      state
      status
    }
  }
}
```

#### Restart Container (Sequential)
```graphql
# First stop, then start
mutation StopContainer($id: PrefixedID!) {
  docker {
    stop(id: $id) {
      id
    }
  }
}

mutation StartContainer($id: PrefixedID!) {
  docker {
    start(id: $id) {
      id
      state
      status
    }
  }
}
```

### Virtual Machine Mutations

#### Start VM
```graphql
mutation StartVM($id: PrefixedID!) {
  vm {
    start(id: $id)
  }
}
```

#### Stop VM (Force)
```graphql
mutation StopVM($id: PrefixedID!) {
  vm {
    stop(id: $id)
  }
}
```

#### Shutdown VM (Graceful)
```graphql
mutation ShutdownVM($id: PrefixedID!) {
  vm {
    shutdown(id: $id)
  }
}
```

## Implementation Details

### 1. Domain Definition Updates

**File**: `src/shared/unraid-domains.ts`

```typescript
// Add to DomainId type
export type DomainId =
    | ... // existing
    | 'docker.controls'
    | 'vms.controls';

// Add control state mappings
export const DOCKER_CONTROL_STATES: StateMapping[] = [
    {
        id: 'controls.start',
        path: [],  // No data path - write-only
        common: {
            type: 'boolean',
            role: 'button.start',
            read: true,
            write: true,
            def: false,
            name: 'Start Container'
        }
    },
    {
        id: 'controls.stop',
        path: [],
        common: {
            type: 'boolean',
            role: 'button.stop',
            read: true,
            write: true,
            def: false,
            name: 'Stop Container'
        }
    },
    {
        id: 'controls.restart',
        path: [],
        common: {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            def: false,
            name: 'Restart Container'
        }
    }
];

export const VM_CONTROL_STATES: StateMapping[] = [
    {
        id: 'controls.start',
        path: [],
        common: {
            type: 'boolean',
            role: 'button.start',
            read: true,
            write: true,
            def: false,
            name: 'Start VM'
        }
    },
    {
        id: 'controls.stop',
        path: [],
        common: {
            type: 'boolean',
            role: 'button.stop',
            read: true,
            write: true,
            def: false,
            name: 'Force Stop VM'
        }
    },
    {
        id: 'controls.shutdown',
        path: [],
        common: {
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            def: false,
            name: 'Shutdown VM'
        }
    }
];
```

### 2. Dynamic Resource Manager Updates

**File**: `src/managers/dynamic-resource-manager.ts`

```typescript
private async createDockerContainerStates(containers: DockerContainer[]): Promise<void> {
    for (const container of containers) {
        const basePath = `docker.containers.${sanitizeId(container.name)}`;

        // Create existing readonly states
        // ...

        // Create control button states
        await this.createControlButtons(basePath, 'docker', container.id);
    }
}

private async createVMStates(vms: VM[]): Promise<void> {
    for (const vm of vms) {
        const basePath = `vms.${sanitizeId(vm.name)}`;

        // Create existing readonly states
        // ...

        // Create control buttons
        await this.createControlButtons(basePath, 'vm', vm.id);
    }
}

private async createControlButtons(
    basePath: string,
    type: 'docker' | 'vm',
    resourceId: string
): Promise<void> {
    const controls = type === 'docker'
        ? DOCKER_CONTROL_STATES
        : VM_CONTROL_STATES;

    for (const control of controls) {
        const stateId = `${basePath}.${control.id}`;

        await this.adapter.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: {
                ...control.common,
                custom: {}
            },
            native: {
                resourceType: type,
                resourceId: resourceId,
                action: control.id.split('.').pop()  // Extract action name
            }
        });

        // Initialize button state to false
        await this.adapter.setStateAsync(stateId, false, true);
    }
}
```

### 3. State Change Handler Implementation

**File**: `src/main.ts`

```typescript
private async onStateChange(
    id: string,
    state: ioBroker.State | null | undefined
): Promise<void> {
    // Ignore acknowledged states and deletions
    if (!state || state.ack || !state.val) {
        return;
    }

    // Check if this is a control button
    if (!id.includes('.controls.')) {
        return;
    }

    try {
        // Get the object to retrieve native properties
        const obj = await this.getObjectAsync(id);
        if (!obj || !obj.native) {
            this.log.error(`No object found for control state ${id}`);
            return;
        }

        const { resourceType, resourceId, action } = obj.native;

        this.log.info(`Executing ${action} for ${resourceType} ${resourceId}`);

        // Execute the appropriate mutation
        if (resourceType === 'docker') {
            await this.handleDockerControl(resourceId, action as string);
        } else if (resourceType === 'vm') {
            await this.handleVMControl(resourceId, action as string);
        }

        // Reset button state
        await this.setStateAsync(id, false, true);

        // Trigger a data refresh after 5 seconds
        setTimeout(() => {
            this.log.debug('Refreshing data after control action');
            this.pollingManager?.poll();
        }, 5000);

    } catch (error) {
        this.log.error(`Failed to execute control action: ${error}`);
        // Reset button on error
        await this.setStateAsync(id, false, true);
    }
}

private async handleDockerControl(
    containerId: string,
    action: string
): Promise<void> {
    switch (action) {
        case 'start':
            await this.apolloClient.mutate(
                DOCKER_START_MUTATION,
                { id: containerId }
            );
            break;

        case 'stop':
            await this.apolloClient.mutate(
                DOCKER_STOP_MUTATION,
                { id: containerId }
            );
            break;

        case 'restart':
            // Stop then start
            await this.apolloClient.mutate(
                DOCKER_STOP_MUTATION,
                { id: containerId }
            );
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.apolloClient.mutate(
                DOCKER_START_MUTATION,
                { id: containerId }
            );
            break;

        default:
            throw new Error(`Unknown Docker action: ${action}`);
    }
}

private async handleVMControl(
    vmId: string,
    action: string
): Promise<void> {
    switch (action) {
        case 'start':
            await this.apolloClient.mutate(
                VM_START_MUTATION,
                { id: vmId }
            );
            break;

        case 'stop':
            await this.apolloClient.mutate(
                VM_STOP_MUTATION,
                { id: vmId }
            );
            break;

        case 'shutdown':
            await this.apolloClient.mutate(
                VM_SHUTDOWN_MUTATION,
                { id: vmId }
            );
            break;

        default:
            throw new Error(`Unknown VM action: ${action}`);
    }
}
```

### 4. GraphQL Mutation Definitions

**File**: `src/graphql/mutations.ts` (new file)

```typescript
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

export const VM_SHUTDOWN_MUTATION = `
    mutation ShutdownVM($id: PrefixedID!) {
        vm {
            shutdown(id: $id)
        }
    }
`;
```

### 5. Apollo Client Extension

**File**: `src/apollo-client.ts`

The existing `mutate` method is already sufficient:

```typescript
async mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>
): Promise<T> {
    const result = await this.client.mutate<T>({
        mutation: gql(mutation),
        variables,
        fetchPolicy: 'no-cache'  // Ensure fresh execution
    });

    if (result.errors) {
        throw new Error(
            `GraphQL mutation failed: ${result.errors.map(e => e.message).join(', ')}`
        );
    }

    return result.data!;
}
```

## Error Handling

### Error Scenarios

1. **Network Errors**: Connection to Unraid server fails
2. **Authentication Errors**: API token invalid or expired
3. **Permission Errors**: User lacks UPDATE_ANY permission
4. **Resource Not Found**: Container/VM ID doesn't exist
5. **Invalid State**: Container already running when start pressed
6. **GraphQL Errors**: Malformed query or server errors

### Error Handling Strategy

```typescript
try {
    await executeMutation();
} catch (error) {
    if (error instanceof ApolloError) {
        if (error.networkError) {
            this.log.error(`Network error: ${error.networkError.message}`);
            // Could set a connection error state
        } else if (error.graphQLErrors?.length) {
            error.graphQLErrors.forEach(err => {
                this.log.error(`GraphQL error: ${err.message}`);
                // Parse specific error types
                if (err.extensions?.code === 'FORBIDDEN') {
                    this.log.error('Permission denied - check API token permissions');
                }
            });
        }
    } else {
        this.log.error(`Unexpected error: ${error}`);
    }

    // Always reset button state on error
    await this.setStateAsync(buttonId, false, true);

    // Optionally set error state
    await this.setStateAsync(`${basePath}.lastError`, error.message, true);
}
```

## Security Considerations

### Permission Requirements

The API token must have the following permissions:
- **Action**: `UPDATE_ANY`
- **Resources**: `DOCKER`, `VMS`

### Safety Measures

1. **No Automatic Actions**: All controls require explicit user interaction
2. **Confirmation States**: Consider adding confirmation for destructive actions
3. **Rate Limiting**: Prevent rapid button clicks
4. **Audit Logging**: Log all control actions with timestamp and result

### Rate Limiting Implementation

```typescript
private lastActionTime: Map<string, number> = new Map();
private readonly MIN_ACTION_INTERVAL = 2000; // 2 seconds

private async onStateChange(id: string, state: ioBroker.State): Promise<void> {
    // Check rate limiting
    const lastTime = this.lastActionTime.get(id) || 0;
    const now = Date.now();

    if (now - lastTime < this.MIN_ACTION_INTERVAL) {
        this.log.warn(`Action rate limited for ${id}`);
        await this.setStateAsync(id, false, true);
        return;
    }

    this.lastActionTime.set(id, now);
    // ... continue with action
}
```

## Testing Plan

### Unit Tests

1. **Button Creation**: Verify control buttons are created with correct properties
2. **State Change Handler**: Test command recognition and routing
3. **Mutation Execution**: Mock Apollo client, verify correct mutations
4. **Error Handling**: Test various error scenarios
5. **Rate Limiting**: Verify rapid clicks are blocked

### Integration Tests

1. **Docker Container Lifecycle**:
   - Start stopped container
   - Stop running container
   - Restart container
   - Handle already running/stopped states

2. **VM Lifecycle**:
   - Start VM
   - Graceful shutdown
   - Force stop
   - Handle state transitions

3. **Permission Tests**:
   - Test with insufficient permissions
   - Verify error messages

### Manual Testing Checklist

- [ ] Docker container start from stopped state
- [ ] Docker container stop from running state
- [ ] Docker container restart
- [ ] VM start from shutdown state
- [ ] VM graceful shutdown
- [ ] VM force stop
- [ ] Rapid button clicks (rate limiting)
- [ ] Network disconnection during action
- [ ] Invalid container/VM ID
- [ ] Concurrent actions on same resource

## Migration Strategy

### Backward Compatibility

- Existing readonly states remain unchanged
- Control states are added as new objects
- No breaking changes to existing functionality

### Rollout Plan

1. **Phase 1**: Docker container controls (start, stop)
2. **Phase 2**: VM controls (start, stop, shutdown)
3. **Phase 3**: Extended controls (restart, pause, resume)
4. **Phase 4**: Array operations (optional future)

### Feature Flags

```typescript
interface AdapterConfig {
    // ... existing
    enableControls?: boolean;  // Default: false initially
    controlsDocker?: boolean;  // Default: true when enabled
    controlsVM?: boolean;      // Default: true when enabled
}
```

## Documentation Updates

### User Documentation

1. **README.md**: Add control features section
2. **Configuration Guide**: Document required permissions
3. **Usage Examples**: Button usage in automations

### Developer Documentation

1. **architecture.md**: Add control flow diagrams
2. **development.md**: Document testing procedures
3. **unraid-api.md**: Add mutation examples

### Changelog Entry

```markdown
## [0.6.0] - 2025-XX-XX
### Added
- Docker container control buttons (start, stop, restart)
- Virtual machine control buttons (start, stop, shutdown)
- GraphQL mutations support for control operations
- Rate limiting for control actions

### Security
- Requires UPDATE_ANY permission for control features
- Added rate limiting to prevent rapid action execution
```

## Performance Considerations

### Optimization Strategies

1. **Debouncing**: Prevent multiple rapid mutations
2. **Caching**: Cache container/VM IDs to avoid lookups
3. **Batch Updates**: Group button state resets
4. **Lazy Loading**: Only create control buttons when domain selected

### Resource Impact

- **Memory**: ~100 bytes per control button state
- **Network**: One GraphQL request per action
- **CPU**: Minimal - only during action execution

## Future Enhancements

### Potential Features

1. **Confirmation Dialogs**: For destructive actions
2. **Bulk Operations**: Start/stop all containers
3. **Scheduled Actions**: Time-based controls
4. **Conditional Controls**: Enable/disable based on state
5. **Action Feedback**: Progress indicators
6. **Action History**: Log of recent control actions
7. **Custom Actions**: User-defined GraphQL mutations

### Extended Controls

- **Docker**:
  - Pause/Unpause
  - Kill (force terminate)
  - Update (pull latest image)

- **VMs**:
  - Suspend/Resume
  - Snapshot creation
  - Resource adjustment

- **Array**:
  - Start/Stop array
  - Initiate parity check
  - Spin up/down disks

## Conclusion

This implementation plan provides a comprehensive approach to adding control capabilities to the ioBroker Unraid adapter. By following the proven patterns from adapters like Proxmox and adhering to ioBroker conventions, we ensure a reliable and user-friendly solution.

The phased approach allows for iterative development and testing, while the security measures ensure safe operation in production environments.

## Appendix

### A. GraphQL Type Definitions

```graphql
type DockerMutations {
  start(id: PrefixedID!): DockerContainer!
  stop(id: PrefixedID!): DockerContainer!
}

type VmMutations {
  start(id: PrefixedID!): Boolean!
  stop(id: PrefixedID!): Boolean!
  shutdown(id: PrefixedID!): Boolean!
}

type Mutation {
  docker: DockerMutations!
  vm: VmMutations!
}
```

### B. Example Automation Script

```javascript
// ioBroker automation to restart container at 3 AM
schedule("0 3 * * *", async function () {
    setState('unraid.0.docker.containers.myapp.controls.restart', true);
});

// Stop all containers before array maintenance
on({id: 'unraid.0.maintenance.start'}, async function() {
    const containers = getStates('unraid.0.docker.containers.*.state');
    for (const [id, state] of Object.entries(containers)) {
        if (state.val === 'RUNNING') {
            const stopButton = id.replace('.state', '.controls.stop');
            setState(stopButton, true);
            await wait(5000); // Wait 5s between stops
        }
    }
});
```

### C. References

- [ioBroker State Roles Documentation](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md)
- [Proxmox Adapter Implementation](https://github.com/iobroker-community-adapters/ioBroker.proxmox)
- [Unraid GraphQL API Documentation](https://docs.unraid.net/api/)
- [Apollo Client Documentation](https://www.apollographql.com/docs/react/)