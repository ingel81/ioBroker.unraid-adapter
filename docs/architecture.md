# ioBroker Unraid Adapter - Architecture

## Overview

This adapter connects ioBroker to Unraid servers via GraphQL API, providing real-time system metrics and status information for home automation.

## Core Components

### Main Adapter (`src/main.ts`)

- Extends ioBroker Adapter base class
- Manages GraphQL polling lifecycle
- Handles state updates and object management
- Key features:
    - Configurable polling intervals (default: 60 seconds)
    - Dynamic domain selection via admin UI
    - Automatic object tree cleanup on startup
    - Self-signed certificate support
    - Dynamic CPU core detection
    - Dynamic array disk detection (data, parity, cache)
    - Dynamic Docker container detection
    - Dynamic share detection
    - Dynamic VM detection

### Apollo Client (`src/apollo-client.ts`)

- Unified GraphQL client using Apollo
- HTTP/WebSocket split link configuration
- Self-signed certificate handling via undici Agent
- Custom WebSocket implementation for auth headers
- Subscription support (currently disabled due to Unraid API issues)

### Domain System (`src/shared/unraid-domains.ts`)

- Defines available metric domains and their GraphQL mappings
- Hierarchical domain structure:
    - `info.time` - System time
    - `info.os` - OS details (distro, release, kernel)
    - `server.status` - Server name, status, IPs, URLs
    - `metrics.cpu` - CPU usage with dynamic core detection
    - `metrics.memory` - Memory usage including swap (converted to GB)
    - `array.status` - Array state and capacity
    - `array.disks` - Data disk details (dynamic)
    - `array.parities` - Parity disk details (dynamic)
    - `array.caches` - Cache disk details (dynamic)
    - `docker.containers` - Docker container states (dynamic)
    - `shares.list` - Share usage and configuration (dynamic)
    - `vms.list` - Virtual machine states (dynamic)
- Each domain definition includes:
    - GraphQL selection fields
    - ioBroker state mappings
    - Value transformations (e.g., bytes to GB)

### Admin Interface (`admin/src/`)

- React-based configuration UI with Material-UI
- Component structure:
    - `app.tsx` - Main application wrapper
    - `components/settings.tsx` - Configuration form with domain tree selector
- Features:
    - Visual domain selection tree
    - Connection validation
    - Subscription toggle (for future use)
    - Real-time config updates

## Data Flow

### 1. Initialization Phase

```
Adapter Start
    ↓
Validate Config (URL, Token, Domains)
    ↓
Expand Domain Selection
    ↓
Initialize Static States
    ↓
Clean Orphaned Objects
    ↓
Start Polling Timer
```

### 2. Polling Cycle

```
Timer Trigger
    ↓
Build GraphQL Query (GraphQLSelectionBuilder)
    ↓
Execute Query (Apollo Client)
    ↓
Transform Response (applyDefinition)
    ↓
Update ioBroker States
```

### 3. State Management

- Static states created on startup with null values
- Dynamic states created on first poll for:
    - CPU cores based on actual core count
    - Array disks (data, parity, cache) based on configuration
    - Docker containers based on running/stopped containers
    - Shares based on configured shares
    - VMs based on configured virtual machines
- State paths follow domain hierarchy: `unraid.0.metrics.cpu.cores.0.percentTotal`
- Automatic null value prevention when data unavailable

## Key Design Decisions

### Apollo Client Migration (2025-09-21)

- Migrated from custom GraphQL client to Apollo for better maintainability
- Benefits: Built-in caching, error handling, subscription support
- WebSocket implementation requires class instead of factory function

### Polling vs Subscriptions

- **Initial Goal**: Use GraphQL subscriptions for real-time updates
- **Issues Discovered**:
    - Unraid's `arraySubscription` returns null (API bug)
    - Subscription frequency too high for home automation (multiple updates/second)
    - Not all data available via subscriptions
- **Decision**: Use polling exclusively with configurable intervals

### Dynamic State Detection

#### CPU Cores
- Detects CPU core count from first metrics response
- Creates states dynamically for each core
- Supports any number of cores (tested with 12)
- No hot-plug support (core count fixed after detection)

#### Array Disks (2025-09-22)
- Detects data, parity, and cache disks dynamically
- Creates states for each disk including:
    - Basic info: name, device, status, temperature
    - Sizes: total, filesystem size/used/free, usage percentage
    - Performance: read/write counts, error counts
- Handles null filesystem values for parity disks

#### Docker Containers (2025-09-22)
- Detects all Docker containers (running and stopped)
- Creates states for each container:
    - name, image, state (RUNNING/EXITED)
    - status text, autoStart flag, size in GB
- Container names sanitized for object IDs

#### Shares (2025-09-22)
- Detects all configured shares
- Creates states for each share:
    - Usage: free/used/size in GB, usage percentage
    - Config: comment, allocator, COW mode, color status
- Calculates usage percentage from used/(used+free)

#### Virtual Machines (2025-09-22)
- Detects all configured VMs
- Creates states for each VM:
    - name, state (RUNNING/SHUTOFF), UUID
- VM names sanitized for object IDs

### Extended Memory Metrics

- Added comprehensive memory monitoring:
    - Available memory (better indicator than "free")
    - Active memory
    - Buffer/Cache (can be freed if needed)
    - Complete swap statistics
- All values converted from bytes to GB for readability

## Object Hierarchy

```
unraid.0/
├── info/
│   ├── time                    # ISO timestamp
│   └── os/
│       ├── distro              # "Unraid"
│       ├── release             # Version string
│       └── kernel              # Kernel version
├── server/
│   ├── name                    # Server hostname
│   ├── status                  # "online"/"offline"
│   ├── lanip                   # LAN IP address
│   ├── wanip                   # WAN IP address
│   ├── localurl                # Local access URL
│   └── remoteurl               # Remote access URL
├── metrics/
│   ├── cpu/
│   │   ├── percentTotal        # Overall CPU usage %
│   │   └── cores/
│   │       ├── count           # Number of cores
│   │       └── [0-n]/          # Per-core metrics
│   │           ├── percentTotal
│   │           ├── percentUser
│   │           ├── percentSystem
│   │           ├── percentNice
│   │           ├── percentIdle
│   │           └── percentIrq
│   └── memory/
│       ├── percentTotal        # Memory usage %
│       ├── totalGb             # Total RAM
│       ├── usedGb              # Used RAM
│       ├── freeGb              # Free RAM
│       ├── availableGb         # Available RAM
│       ├── activeGb            # Active memory
│       ├── buffcacheGb         # Buffer/Cache
│       └── swap/
│           ├── totalGb         # Total swap
│           ├── usedGb          # Used swap
│           ├── freeGb          # Free swap
│           └── percentTotal    # Swap usage %
├── array/
│   ├── state                   # Array state (STARTED, etc.)
│   ├── capacity/
│   │   ├── totalGb            # Total array capacity
│   │   ├── usedGb             # Used space
│   │   ├── freeGb             # Free space
│   │   └── percentUsed        # Usage percentage
│   ├── disks/
│   │   ├── count              # Number of data disks
│   │   └── [0-n]/             # Per-disk metrics
│   │       ├── name           # Disk name
│   │       ├── device         # Device path
│   │       ├── status         # Disk status
│   │       ├── temp           # Temperature °C
│   │       ├── sizeGb         # Disk size
│   │       ├── fsSizeGb       # Filesystem size
│   │       ├── fsUsedGb       # Used space
│   │       ├── fsFreeGb       # Free space
│   │       ├── fsUsedPercent  # Usage percentage
│   │       └── ...
│   ├── parities/              # Similar to disks
│   └── caches/                # Similar to disks
├── docker/
│   └── containers/
│       ├── count              # Number of containers
│       └── [container_name]/  # Per-container states
│           ├── name           # Container name
│           ├── image          # Docker image
│           ├── state          # RUNNING/EXITED
│           ├── status         # Status text
│           ├── autoStart      # Auto-start enabled
│           └── sizeGb         # Root filesystem size
├── shares/
│   ├── count                  # Number of shares
│   └── [share_name]/          # Per-share states
│       ├── name               # Share name
│       ├── freeGb             # Free space
│       ├── usedGb             # Used space
│       ├── sizeGb             # Total size
│       ├── usedPercent        # Usage percentage
│       ├── comment            # Share comment
│       ├── allocator          # Allocation method
│       ├── cow                # Copy-on-write setting
│       └── color              # Status color
└── vms/
    ├── count                  # Number of VMs
    └── [vm_name]/             # Per-VM states
        ├── name               # VM name
        ├── state              # RUNNING/SHUTOFF
        └── uuid               # VM UUID
```

## Configuration

### Required Settings

- `baseUrl` - Unraid server URL (e.g., `https://192.168.1.100`)
- `apiToken` - API token from Unraid settings
- `pollIntervalSeconds` - Polling interval (default: 60)
- `allowSelfSigned` - Allow self-signed certificates
- `enabledDomains` - Selected data domains

### Optional Features

- `useSubscriptions` - Enable GraphQL subscriptions (experimental, currently disabled)

## Error Handling

### Connection Errors

- Validates connection on config save
- Retries with exponential backoff
- Logs detailed error messages

### GraphQL Errors

- Handles partial responses gracefully
- Skips null values in state updates
- Logs field-level errors for debugging

### Certificate Issues

- Supports self-signed certificates via config option
- Uses undici Agent for TLS configuration
- Proper certificate validation when enabled

## Performance Considerations

### Polling Optimization

- Single GraphQL query for all selected domains
- Configurable interval to balance load vs freshness
- Minimal state updates (only on value change)

### Memory Management

- Reuses Apollo Client instance
- Cleans up subscriptions on adapter stop
- Efficient object tree management

### Network Efficiency

- HTTP keep-alive for connection reuse
- GraphQL query batching
- Compressed responses

## Future Enhancements

### Planned Features

1. Re-enable subscriptions when Unraid API is fixed
2. Add more domains (UPS, notifications, parity history)
3. Implement differential updates
4. Add metrics history/trending
5. Add VM resource usage metrics
6. Add Docker container resource metrics

### Known Limitations

- Array subscription broken in Unraid API
- No hot-plug support for dynamic resources (CPUs, disks, containers)
- Subscription frequency too high for practical use
- Some Unraid versions omit optional GraphQL fields
- Container and VM names must be sanitized for object IDs
- Parity disks may have null filesystem values

## Testing

- Tested with Unraid 7.1.4 x86_64
- Verified with 12 CPU cores
- Self-signed certificate support confirmed
- Apollo Client stable with polling approach
