# Technical Notes - Unraid Adapter Development

## Apollo Client Integration

### Migration from Custom GraphQL Client (2025-09-21)

Successfully migrated from a custom GraphQL client to Apollo Client for better maintainability and features.

**Key Changes:**
- Replaced custom `graphql-client.ts` with Apollo Client
- All GraphQL operations (queries, mutations, subscriptions) now use unified Apollo Client
- Improved error handling and retry logic
- Better TypeScript support

**Dependencies added:**
```json
"@apollo/client": "^3.11.0",
"graphql": "^16.9.0",
"graphql-ws": "^5.16.0",
"ws": "^8.18.0"
```

## GraphQL Subscriptions Analysis

### Available Unraid Subscriptions

The Unraid GraphQL API provides these subscriptions:
- `systemMetricsCpu` - Real-time CPU metrics ✅ Working
- `systemMetricsMemory` - Real-time memory metrics ✅ Working
- `serversSubscription` - Server status updates ✅ Working
- `arraySubscription` - Array status ❌ **BROKEN** (returns null, API bug)
- `notificationAdded` - New system notifications (untested)
- `upsUpdates` - UPS status updates (untested)
- `parityHistorySubscription` - Parity check history (untested)
- `logFile` - Live log updates (untested)

### Subscription Issues & Decision

**Problem with arraySubscription:**
- The `arraySubscription` is defined as non-nullable in the GraphQL schema
- However, it always returns `null`, causing Apollo errors
- Normal `array` query works fine, indicating a bug in Unraid's subscription implementation

**Architecture Decision:**
- Subscriptions provide too frequent updates for home automation (multiple per second)
- Not all data available via subscriptions (array data broken)
- Decision: **Use polling for all data** with configurable intervals
- Subscription code disabled but preserved for future use

## Extended Metrics Implementation

### Dynamic CPU Core Detection

Implemented dynamic CPU core detection and state creation (Lösung B):

**How it works:**
1. On first poll, detect number of CPU cores from `metrics.cpu.cpus` array
2. Dynamically create states for each detected core
3. Log: "Detected X CPU cores, creating states..."
4. Works for any number of cores (tested with 12 cores)

**Created States per Core:**
```
metrics.cpu.cores.count         # Total number of cores
metrics.cpu.cores.0.percentTotal
metrics.cpu.cores.0.percentUser
metrics.cpu.cores.0.percentSystem
metrics.cpu.cores.0.percentNice
metrics.cpu.cores.0.percentIdle
metrics.cpu.cores.0.percentIrq
# ... repeated for each core
```

### Extended Memory Metrics

Added comprehensive memory monitoring including swap:

**New Memory States:**
```
metrics.memory.availableGb      # Actually available memory (better than "free")
metrics.memory.activeGb          # Actively used memory
metrics.memory.buffcacheGb       # Buffer/Cache (can be freed if needed)
metrics.memory.swap.totalGb      # Total swap space
metrics.memory.swap.usedGb       # Used swap space
metrics.memory.swap.freeGb       # Free swap space
metrics.memory.swap.percentTotal # Swap usage percentage
```

### GraphQL Query Structure

Complete metrics query now includes:
```graphql
query Metrics {
  metrics {
    cpu {
      percentTotal
      cpus {
        percentTotal
        percentUser
        percentSystem
        percentNice
        percentIdle
        percentIrq
      }
    }
    memory {
      total
      used
      free
      available
      active
      buffcache
      percentTotal
      swapTotal
      swapUsed
      swapFree
      percentSwapTotal
    }
  }
}
```

## Code Architecture

### State Management
- Static states defined in `unraid-domains.ts`
- Dynamic CPU core states created in `main.ts` via `handleDynamicCpuCores()`
- Admin UI only shows top-level domains, detail fields automatically included

### Null Value Prevention
- `applyDefinition()` checks if domain data exists before processing
- Prevents null updates when data not available in query response

### WebSocket Implementation Notes

**Self-signed Certificate Handling:**
```typescript
// For Apollo with self-signed certs
class CustomWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
        const wsOptions: ClientOptions = {
            rejectUnauthorized: !options.allowSelfSigned,
            headers: { 'x-api-key': options.apiToken }
        };
        super(url, protocols, wsOptions);
    }
}
```

**Important:** `graphql-ws` expects a WebSocket class, not a factory function.

## Performance Considerations

### Subscription Throttling
- Subscriptions can send multiple updates per second
- Implemented throttling: `UPDATE_THROTTLE_MS = 1000` (max 1 update/sec)
- Still too frequent for home automation use case

### Polling Optimization
- Configurable interval (default 60 seconds)
- All data fetched in single GraphQL query
- Predictable load on system

## Future Improvements

### Potential Enhancements
1. Make subscription throttling configurable (if re-enabled)
2. Add more array data when subscription API is fixed
3. Monitor disk temperatures and SMART data
4. Docker container metrics
5. VM statistics

### Known Limitations
- Array subscription broken in Unraid API
- No real-time updates (polling only)
- CPU core states fixed after first detection (no hot-plug support)

## Testing Notes

- Tested with Unraid 7.1 x86_64
- 12 CPU cores detected successfully
- Self-signed certificate support working
- Apollo Client stable with polling approach