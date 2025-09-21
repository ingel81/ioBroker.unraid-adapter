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
- Dynamic CPU core states created on first metrics poll
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

### Dynamic CPU Core Detection

- Detects CPU core count from first metrics response
- Creates states dynamically for each core
- Supports any number of cores (tested with 12)
- No hot-plug support (core count fixed after detection)

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
└── metrics/
    ├── cpu/
    │   ├── percentTotal        # Overall CPU usage %
    │   └── cores/
    │       ├── count           # Number of cores
    │       └── [0-n]/          # Per-core metrics
    │           ├── percentTotal
    │           ├── percentUser
    │           ├── percentSystem
    │           ├── percentNice
    │           ├── percentIdle
    │           └── percentIrq
    └── memory/
        ├── percentTotal        # Memory usage %
        ├── totalGb             # Total RAM
        ├── usedGb              # Used RAM
        ├── freeGb              # Free RAM
        ├── availableGb         # Available RAM
        ├── activeGb            # Active memory
        ├── buffcacheGb         # Buffer/Cache
        └── swap/
            ├── totalGb         # Total swap
            ├── usedGb          # Used swap
            ├── freeGb          # Free swap
            └── percentTotal    # Swap usage %
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
2. Add more domains (array, docker, shares, UPS)
3. Implement differential updates
4. Add metrics history/trending

### Known Limitations

- Array subscription broken in Unraid API
- No hot-plug CPU core support
- Subscription frequency too high for practical use
- Some Unraid versions omit optional GraphQL fields

## Testing

- Tested with Unraid 7.1.4 x86_64
- Verified with 12 CPU cores
- Self-signed certificate support confirmed
- Apollo Client stable with polling approach
