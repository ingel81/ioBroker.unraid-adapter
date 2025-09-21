# Unraid GraphQL API Documentation

## Connection Details

### Endpoint Configuration
- **URL**: `https://<server-ip>/graphql` (HTTPS) or `http://<server-ip>/graphql` (HTTP)
- **Method**: POST
- **Content-Type**: `application/json`
- **Authentication**: `x-api-key: <token>` header
- **WebSocket**: `wss://<server-ip>/graphql` (for subscriptions)

### Obtaining API Token
1. Log into Unraid web interface
2. Navigate to Settings → API Keys
3. Generate new key with appropriate permissions
4. Copy token for adapter configuration

### Example Request
```bash
curl -X POST \
     -H "Content-Type: application/json" \
     -H "x-api-key: <your-token>" \
     --data '{"query":"query { info { time } }"}' \
     https://192.168.1.100/graphql
```

## Self-Signed Certificate Handling

### Using undici Agent (HTTP)
```typescript
import { Agent } from 'undici';

const agent = new Agent({
  connect: {
    rejectUnauthorized: false  // or provide CA cert
  }
});
```

### WebSocket with Custom Implementation
```typescript
import WebSocket from 'ws';

class CustomWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols, {
      rejectUnauthorized: false,
      headers: { 'x-api-key': apiToken }
    });
  }
}
```

## Available GraphQL Operations

### Queries (Polling Data)

#### System Information
```graphql
query SystemInfo {
  info {
    time                    # Current server time (ISO string)
    os {
      name                  # "Unraid"
      distro               # Distribution name
      release              # Version (e.g., "6.12.4")
      kernel               # Kernel version
    }
    versions {
      unraid               # Unraid version
    }
    hardware {
      cpu                  # CPU model string
      memory              # Total memory in bytes
      motherboard         # Motherboard model
    }
  }
}
```

#### Server Status
```graphql
query ServerStatus {
  server {
    name                   # Hostname
    status                 # "online" or "offline"
    guid                   # Server GUID
    lanip                  # LAN IP address
    wanip                  # WAN IP address
    localurl              # Local access URL
    remoteurl             # Remote access URL
  }
}
```

#### System Metrics
```graphql
query Metrics {
  metrics {
    cpu {
      percentTotal         # Overall CPU usage %
      cpus {               # Per-core metrics array
        percentTotal
        percentUser
        percentSystem
        percentNice
        percentIdle
        percentIrq
      }
    }
    memory {
      total               # Total RAM in bytes
      used                # Used RAM in bytes
      free                # Free RAM in bytes
      available           # Available RAM in bytes
      active              # Active memory in bytes
      buffcache           # Buffer/cache in bytes
      percentTotal        # Memory usage %
      swapTotal           # Total swap in bytes
      swapUsed            # Used swap in bytes
      swapFree            # Free swap in bytes
      percentSwapTotal    # Swap usage %
    }
  }
}
```

#### Array Status
```graphql
query ArrayStatus {
  array {
    state                 # "STARTED", "STOPPED", etc.
    capacity {
      kilobytes {
        total
        used
        free
      }
    }
    parityCheckStatus {
      status              # "IDLE", "RUNNING", etc.
      progress            # Progress percentage
      speed               # Speed in bytes/sec
      errors              # Error count
    }
    disks {               # Data disks
      name
      device
      temp                # Temperature in Celsius
      status              # Disk status
      numReads
      numWrites
      spinning            # Boolean
    }
    caches {              # Cache disks
      name
      temp
      status
    }
    parities {            # Parity disks
      name
      temp
      status
    }
  }
}
```

#### Docker Containers
```graphql
query DockerInfo {
  docker {
    containers(skipCache: false) {
      names               # Container name
      state               # "running", "stopped", etc.
      status              # Status text
      image               # Image name
      autoStart           # Auto-start enabled
      created             # Creation timestamp
      ports {
        container
        host
        protocol
      }
      mounts {
        source
        destination
        mode
      }
    }
  }
}
```

#### Virtual Machines
```graphql
query VirtualMachines {
  vms {
    domains {
      name                # VM name
      uuid                # VM UUID
      state               # "RUNNING", "SHUTDOWN", etc.
    }
  }
}
```

#### Shares
```graphql
query Shares {
  shares {
    name                  # Share name
    comment              # Description
    allocator            # Allocation method
    splitLevel           # Split level
    cacheMode            # Cache usage mode
    kilobytes {
      size               # Total size
      used               # Used space
      free               # Free space
    }
    luksStatus           # Encryption status
  }
}
```

#### UPS Devices
```graphql
query UPSStatus {
  upsDevices {
    name                  # UPS name
    model                # Model string
    status               # UPS status
    battery {
      health             # Battery health
      chargeLevel        # Charge % (0-100)
      estimatedRuntime   # Runtime in seconds
    }
    power {
      inputVoltage       # Input voltage
      outputVoltage      # Output voltage
      loadPercentage     # Load %
    }
  }
}
```

### Subscriptions (Real-time Updates)

**⚠️ Note**: Subscriptions are currently problematic in Unraid's implementation:
- `arraySubscription` returns null despite being non-nullable (API bug)
- Update frequency is too high for home automation (multiple per second)
- Not all data available via subscriptions

#### Available Subscriptions
```graphql
subscription CPUMetrics {
  systemMetricsCpu {
    percentTotal
    cpus {
      percentTotal
      percentUser
      percentSystem
    }
  }
}

subscription MemoryMetrics {
  systemMetricsMemory {
    percentTotal
    total
    used
    free
    available
  }
}

subscription ServerUpdates {
  serversSubscription {
    name
    status
  }
}

# ⚠️ BROKEN - Returns null
subscription ArrayUpdates {
  arraySubscription {
    state
  }
}
```

## GraphQL Schema Notes

### Required Permissions
All queries require `READ_ANY` action combined with the relevant resource:
- `ARRAY` - Array operations
- `DOCKER` - Docker container info
- `INFO` - System information
- `METRICS` - Performance metrics
- `SERVER` - Server status
- `SHARES` - Share information
- `UPS` - UPS device status
- `VMS` - Virtual machine info

### Common Types

#### ArrayDisk
```graphql
type ArrayDisk {
  name: String!
  device: String!
  temp: Int
  status: String!
  numReads: BigInt
  numWrites: BigInt
  spinning: Boolean
  smart: SmartData
}
```

#### Container
```graphql
type Container {
  names: String!
  state: String!
  status: String!
  image: String!
  autoStart: Boolean
  created: BigInt
  ports: [Port!]
  mounts: [Mount!]
}
```

### Error Handling

#### Field-Level Errors
Some Unraid versions omit optional fields. Handle gracefully:
```javascript
try {
  const data = await client.query({ query: METRICS_QUERY });
  // Process data
} catch (error) {
  if (error.graphQLErrors) {
    // Log field errors but continue
    console.warn('Some fields unavailable:', error.graphQLErrors);
  }
}
```

#### Connection Errors
- Invalid token: HTTP 401
- Server unreachable: Network timeout
- Invalid query: HTTP 400 with GraphQL errors

## Implementation Recommendations

### Query Composition
Build queries dynamically based on selected domains:
```typescript
const fragments = [];
if (domains.includes('metrics.cpu')) {
  fragments.push('cpu { percentTotal cpus { ... } }');
}
if (domains.includes('metrics.memory')) {
  fragments.push('memory { percentTotal total used ... }');
}
const query = `query { metrics { ${fragments.join(' ')} } }`;
```

### Polling Strategy
- **Fast** (10-60s): CPU, Memory metrics
- **Medium** (60-300s): Server status, Array state
- **Slow** (300-600s): Share usage, UPS status
- **On-demand**: Docker containers, VMs

### Data Transformations
- Convert bytes to GB for memory values
- Parse timestamps to ISO strings
- Handle null temperatures gracefully
- Normalize status strings to lowercase

### Caching Considerations
- Docker API supports `skipCache` parameter
- Consider local caching for slow-changing data
- Implement differential updates for efficiency

## Testing Queries

### GraphQL Playground
Access at `https://<server-ip>/graphql` with browser:
1. Add `x-api-key` header in HTTP headers section
2. Use introspection to explore schema
3. Test queries before implementing

### Introspection Query
```graphql
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      ...FullType
    }
  }
}
```

## Known Issues & Limitations

1. **Array Subscription Bug**: Returns null despite non-nullable schema definition
2. **High Update Frequency**: Subscriptions send updates multiple times per second
3. **Missing Optional Fields**: Some Unraid versions omit hardware/version fields
4. **No Mutations**: Unraid GraphQL is read-only (no control operations)
5. **Schema Versioning**: No explicit API versioning, schema may change between Unraid releases