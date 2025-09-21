# Unraid GraphQL Exploration

Date: 2025-02-14

## Endpoint & Authentication

- **Endpoint**: `POST http://192.168.0.30/graphql`
- **Auth header**: `x-api-key: <token>` (matches the token issued in the Unraid admin UI)
- **Content type**: `application/json`
- Example request skeleton:

  ```bash
  curl -X POST \
       -H "Content-Type: application/json" \
       -H "x-api-key: <token>" \
       --data '{"query":"query { info { time } }"}' \
       http://192.168.0.30/graphql
  ```

The introspection response can be regenerated and saved locally as `.tmp_unraid_schema.json` (git-ignored).

## Schema Highlights (Query Root)

Most relevant fields returned by the `Query` root:

- `array` – overall array health, parity status, and member disks (data/parity/cache)
- `disks` – all detected physical drives with SMART readings and metadata
- `docker` – Docker daemon summary (`containers(skipCache: Boolean)`, networks)
- `vms` – libvirt VM domains with state/name information
- `metrics` – CPU and memory utilisation including per-core data
- `info` – hardware/OS details (CPU, board, memory, versions, etc.)
- `server` – owner details, GUID, LAN/WAN IPs, URLs, online/offline state
- `services` – core Unraid services with online flag and uptime
- `shares` – share usage (free/used/total KB), cache usage, include/exclude disks
- `upsDevices` – UPS status, battery charge/runtime, voltages, load
- Additional useful fields: `parityHistory`, `notifications`, `network`, `plugins`, `remoteAccess`, `cloud`, `rclone`

All Query fields require the `READ_ANY` action combined with the relevant resource (e.g. `ARRAY`, `DOCKER`, `INFO`).

## Domain Details

### System & Metrics (`info`, `server`, `metrics`, `services`, `network`)

- `info` exposes rich hardware metadata (CPU model, memory totals, motherboard, OS/Unraid versions).
- `server` provides system identifiers plus LAN/WAN IPs and local/remote URLs.
- `metrics.cpu.percentTotal` and `metrics.memory.percentTotal` deliver headline utilisation figures; memory totals/used/free/swap are available in bytes.
- `services` enumerates Unraid subsystems (SMB, NFS, etc.) with `online` state and `uptime.timestamp`.
- `network.accessUrls` yields IP-based URLs (IPv4/IPv6) and type metadata for dashboard access.

### Array & Disk Health (`array`, `disks`)

- `array.state`, `parityCheckStatus` (status/progress/speed/errors) and combined capacities in KB and disk counts.
- `array.disks`, `array.caches`, `array.parities`, `array.boot` all reuse the `ArrayDisk` type featuring temps, SMART counters, rotational flag, spin status, and thresholds.
- `disks` exposes every detected drive (even outside the array) with vendor/model, firmware, SMART status, interface type, temperature, partitions, and health metrics.

### Workloads (`docker`, `vms`)

- `docker.containers(skipCache: Boolean = false)` returns state, status text, image, creation timestamp, ports, sizes, mounts, `autoStart`, etc.
- `vms.domains` lists VM UUIDs, display names, and `VmState` (e.g. `RUNNING`, `PAUSED`, `SHUTDOWN`).

### Storage Shares (`shares`)

- Each share reports total/used/free (KB), include/exclude disk lists, cache mode, allocator, split level, encryption (`luksStatus`), and comments.

### Power Protection (`upsDevices`)

- `UPSDevice` bundles model, status, plus nested `battery` (health, chargeLevel %, runtime seconds) and `power` (input/output voltage, load %).

### Other Notables

- `notifications` – pending system alerts.
- `parityHistory` – historical parity check runs with timestamps/duration.
- `plugins`, `remoteAccess`, `cloud`, `rclone` – auxiliary services to explore later.

## Example Aggregated Query

Reference query covering the main data we intend to model:

```graphql
# Simplified reference – the adapter now composes this dynamically
query UnraidOverview {
  info {
    time
    os { name version }
    versions { unraid }
    # Some firmware revisions omit os/version/hardware – the adapter drops them on 400 errors
  }
  server { name status lanip localurl }
  metrics {
    cpu { percentTotal }
    memory { percentTotal total used }
  }
  array {
    state
    capacity { kilobytes { total used free } }
    parityCheckStatus { status progress speed errors }
    disks { name temp status numReads numWrites }
    caches { name temp status }
  }
  docker { containers { names state status autoStart created } }
  vms { domains { name state } }
  shares { name size used free cache }
  upsDevices {
    name
    status
    battery { chargeLevel estimatedRuntime }
    power { inputVoltage loadPercentage }
  }
}
```

## Implementation Considerations

- Build a GraphQL helper around `fetch` with:
  - Configured base URL + token from adapter admin UI (sent via `x-api-key`)
  - Optional `skipCache` toggles (Docker networks/containers support it)
  - Structured error logging, retry/backoff, and schema fallback when Unraid omits optional fields
- Schedule polling intervals per domain (e.g. fast metrics, slower parity history) to avoid overloading the API.
- Map results into ioBroker states grouped by domain:
  - `info.*`, `metrics.*`, `services.<name>.online`
  - `array.state`, `array.parity.*`, `array.disks.<slot>.*`
  - `docker.containers.<name>.*`, `vms.<domain>.*`
  - `shares.<name>.*`, `ups.<id>.*`
- Consider transformations (e.g. convert KB → bytes, timestamps → ISO) and caching to minimise state churn.

## Next Steps

1. Finalise which domains have top priority for the first adapter release.
2. Design ioBroker object/state hierarchy per domain.
3. Implement the shared GraphQL request infrastructure.
4. Add polling logic + state updates incrementally (starting with system metrics, then storage, workloads, UPS).
5. Extend admin UI with polling interval settings once scopes are confirmed and keep the domain selector in sync with GraphQL capabilities (log warnings when the schema rejects fields).

These notes should serve as the reference point when we start the implementation planning session.
