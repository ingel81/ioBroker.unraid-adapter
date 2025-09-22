import type { AdapterInterface } from '../types/adapter-types';
import type { StateManager } from './state-manager';
import {
    kilobytesToGigabytes,
    bytesToGigabytes,
    calculateUsagePercent,
    toNumberOrNull,
    toStringOrNull,
    toBooleanOrNull,
    bigIntToNumber,
} from '../utils/data-transformers';

/**
 * Manages dynamic resource detection and state creation
 * for CPU cores, array disks, Docker containers, shares, and VMs
 */
export class DynamicResourceManager {
    // Dynamic CPU core tracking
    private cpuCoresDetected = false;
    private cpuCoreCount = 0;

    // Dynamic array disk tracking
    private arrayDisksDetected = false;
    private diskCount = 0;
    private parityCount = 0;
    private cacheCount = 0;

    // Dynamic docker container tracking
    private dockerContainersDetected = false;
    private containerNames: Set<string> = new Set();

    // Dynamic shares tracking
    private sharesDetected = false;
    private shareNames: Set<string> = new Set();

    // Dynamic VM tracking
    private vmsDetected = false;
    private vmUuids: Set<string> = new Set();

    constructor(
        private readonly adapter: AdapterInterface,
        private readonly stateManager: StateManager,
    ) {}

    /**
     * Reset tracking for deselected domains
     */
    resetTracking(selectedDomains: Set<string>): void {
        if (!selectedDomains.has('metrics.cpu')) {
            this.cpuCoresDetected = false;
            this.cpuCoreCount = 0;
        }

        if (
            !selectedDomains.has('array.disks') &&
            !selectedDomains.has('array.parities') &&
            !selectedDomains.has('array.caches')
        ) {
            this.arrayDisksDetected = false;
            this.diskCount = 0;
            this.parityCount = 0;
            this.cacheCount = 0;
        }

        if (!selectedDomains.has('docker.containers')) {
            this.dockerContainersDetected = false;
            this.containerNames.clear();
        }

        if (!selectedDomains.has('shares.list')) {
            this.sharesDetected = false;
            this.shareNames.clear();
        }

        if (!selectedDomains.has('vms.list')) {
            this.vmsDetected = false;
            this.vmUuids.clear();
        }
    }

    /**
     * Handle dynamic CPU core state creation and updates
     */
    async handleDynamicCpuCores(data: Record<string, unknown>, selectedDomains: Set<string>): Promise<void> {
        if (!selectedDomains.has('metrics.cpu')) {
            return;
        }

        const metrics = data.metrics as { cpu?: { cpus?: unknown[] } };
        if (!metrics?.cpu?.cpus) {
            return;
        }

        const cores = metrics.cpu.cpus;
        const coreCount = Array.isArray(cores) ? cores.length : 0;

        // Create CPU core states on first detection or if core count changed
        if (!this.cpuCoresDetected || this.cpuCoreCount !== coreCount) {
            this.cpuCoreCount = coreCount;
            this.cpuCoresDetected = true;

            this.adapter.log.info(`Detected ${coreCount} CPU cores, creating states...`);

            // Create core count state
            await this.stateManager.writeState(
                'metrics.cpu.cores.count',
                { type: 'number', role: 'value', unit: '' },
                coreCount,
            );

            // Create states for each CPU core
            for (let i = 0; i < coreCount; i++) {
                const corePrefix = `metrics.cpu.cores.${i}`;

                await this.stateManager.writeState(
                    `${corePrefix}.percentTotal`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(
                    `${corePrefix}.percentUser`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(
                    `${corePrefix}.percentSystem`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(
                    `${corePrefix}.percentNice`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(
                    `${corePrefix}.percentIdle`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(
                    `${corePrefix}.percentIrq`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
            }
        }

        // Update CPU core values
        for (let i = 0; i < cores.length; i++) {
            const core = cores[i] as Record<string, unknown>;
            const corePrefix = `metrics.cpu.cores.${i}`;

            await this.stateManager.updateState(`${corePrefix}.percentTotal`, toNumberOrNull(core.percentTotal));
            await this.stateManager.updateState(`${corePrefix}.percentUser`, toNumberOrNull(core.percentUser));
            await this.stateManager.updateState(`${corePrefix}.percentSystem`, toNumberOrNull(core.percentSystem));
            await this.stateManager.updateState(`${corePrefix}.percentNice`, toNumberOrNull(core.percentNice));
            await this.stateManager.updateState(`${corePrefix}.percentIdle`, toNumberOrNull(core.percentIdle));
            await this.stateManager.updateState(`${corePrefix}.percentIrq`, toNumberOrNull(core.percentIrq));
        }
    }

    /**
     * Handle dynamic array disk state creation and updates
     */
    async handleDynamicArrayDisks(data: Record<string, unknown>, selectedDomains: Set<string>): Promise<void> {
        const hasDisks = selectedDomains.has('array.disks');
        const hasParities = selectedDomains.has('array.parities');
        const hasCaches = selectedDomains.has('array.caches');

        if (!hasDisks && !hasParities && !hasCaches) {
            return;
        }

        const array = data.array as {
            disks?: unknown[];
            parities?: unknown[];
            caches?: unknown[];
        };
        if (!array) {
            return;
        }

        const disks = hasDisks && Array.isArray(array.disks) ? array.disks : [];
        const parities = hasParities && Array.isArray(array.parities) ? array.parities : [];
        const caches = hasCaches && Array.isArray(array.caches) ? array.caches : [];

        const diskCount = hasDisks ? disks.length : this.diskCount;
        const parityCount = hasParities ? parities.length : this.parityCount;
        const cacheCount = hasCaches ? caches.length : this.cacheCount;

        // Create or update disk states if needed
        if (
            !this.arrayDisksDetected ||
            (hasDisks && this.diskCount !== diskCount) ||
            (hasParities && this.parityCount !== parityCount) ||
            (hasCaches && this.cacheCount !== cacheCount)
        ) {
            if (hasDisks) {
                this.diskCount = diskCount;
            }
            if (hasParities) {
                this.parityCount = parityCount;
            }
            if (hasCaches) {
                this.cacheCount = cacheCount;
            }
            this.arrayDisksDetected = true;

            this.adapter.log.info(
                `Detected array configuration: ${diskCount} data disks, ${parityCount} parity disks, ${cacheCount} cache disks`,
            );

            // Create count states only for selected domains
            if (hasDisks) {
                await this.stateManager.writeState(
                    'array.disks.count',
                    { type: 'number', role: 'value', unit: '' },
                    diskCount,
                );
                await this.createDiskStates('array.disks', disks);
            }

            if (hasParities) {
                await this.stateManager.writeState(
                    'array.parities.count',
                    { type: 'number', role: 'value', unit: '' },
                    parityCount,
                );
                await this.createDiskStates('array.parities', parities);
            }

            if (hasCaches) {
                await this.stateManager.writeState(
                    'array.caches.count',
                    { type: 'number', role: 'value', unit: '' },
                    cacheCount,
                );
                await this.createDiskStates('array.caches', caches);
            }
        }

        // Update disk values only for selected domains
        if (hasDisks && disks.length > 0) {
            await this.updateDiskValues('array.disks', disks);
        }
        if (hasParities && parities.length > 0) {
            await this.updateDiskValues('array.parities', parities);
        }
        if (hasCaches && caches.length > 0) {
            await this.updateDiskValues('array.caches', caches);
        }
    }

    /**
     * Handle dynamic Docker container state creation and updates
     */
    async handleDynamicDockerContainers(data: Record<string, unknown>, selectedDomains: Set<string>): Promise<void> {
        if (!selectedDomains.has('docker.containers')) {
            return;
        }

        const docker = data.docker as { containers?: unknown[] };
        if (!docker?.containers) {
            return;
        }

        const containers = Array.isArray(docker.containers) ? docker.containers : [];
        const containerNames = new Set<string>();

        for (const container of containers) {
            const c = container as Record<string, unknown>;
            const names = c.names as string[] | null;
            if (names && Array.isArray(names) && names.length > 0) {
                const name = names[0].replace(/^\//, '');
                containerNames.add(name);
            }
        }

        const needsUpdate =
            !this.dockerContainersDetected ||
            containerNames.size !== this.containerNames.size ||
            ![...containerNames].every(name => this.containerNames.has(name));

        if (needsUpdate) {
            this.containerNames = containerNames;
            this.dockerContainersDetected = true;

            this.adapter.log.info(`Detected ${containerNames.size} Docker containers`);

            await this.stateManager.writeState(
                'docker.containers.count',
                { type: 'number', role: 'value', unit: '' },
                containerNames.size,
            );

            for (const container of containers) {
                const c = container as Record<string, unknown>;
                const names = c.names as string[] | null;
                if (!names || !Array.isArray(names) || names.length === 0) {
                    continue;
                }

                const name = names[0].replace(/^\//, '');
                const containerPrefix = `docker.containers.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.stateManager.writeState(`${containerPrefix}.name`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(`${containerPrefix}.image`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(
                    `${containerPrefix}.state`,
                    { type: 'string', role: 'indicator.status' },
                    null,
                );
                await this.stateManager.writeState(`${containerPrefix}.status`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(
                    `${containerPrefix}.autoStart`,
                    { type: 'boolean', role: 'indicator' },
                    null,
                );
                await this.stateManager.writeState(
                    `${containerPrefix}.sizeGb`,
                    { type: 'number', role: 'value', unit: 'GB' },
                    null,
                );
            }
        }

        // Update container values
        for (const container of containers) {
            const c = container as Record<string, unknown>;
            const names = c.names as string[] | null;
            if (!names || !Array.isArray(names) || names.length === 0) {
                continue;
            }

            const name = names[0].replace(/^\//, '');
            if (!this.containerNames.has(name)) {
                continue;
            }

            const containerPrefix = `docker.containers.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.stateManager.updateState(`${containerPrefix}.name`, name);
            await this.stateManager.updateState(`${containerPrefix}.image`, toStringOrNull(c.image));
            await this.stateManager.updateState(`${containerPrefix}.state`, toStringOrNull(c.state));
            await this.stateManager.updateState(`${containerPrefix}.status`, toStringOrNull(c.status));
            await this.stateManager.updateState(`${containerPrefix}.autoStart`, toBooleanOrNull(c.autoStart));
            await this.stateManager.updateState(`${containerPrefix}.sizeGb`, bytesToGigabytes(c.sizeRootFs));
        }
    }

    /**
     * Handle dynamic share state creation and updates
     */
    async handleDynamicShares(data: Record<string, unknown>, selectedDomains: Set<string>): Promise<void> {
        if (!selectedDomains.has('shares.list')) {
            return;
        }

        const shares = data.shares as unknown[];
        if (!shares || !Array.isArray(shares)) {
            return;
        }

        const shareNames = new Set<string>();
        for (const share of shares) {
            const s = share as Record<string, unknown>;
            const name = s.name as string | null;
            if (name) {
                shareNames.add(name);
            }
        }

        const needsUpdate =
            !this.sharesDetected ||
            shareNames.size !== this.shareNames.size ||
            ![...shareNames].every(name => this.shareNames.has(name));

        if (needsUpdate) {
            this.shareNames = shareNames;
            this.sharesDetected = true;

            this.adapter.log.info(`Detected ${shareNames.size} shares`);

            await this.stateManager.writeState(
                'shares.count',
                { type: 'number', role: 'value', unit: '' },
                shareNames.size,
            );

            for (const share of shares) {
                const s = share as Record<string, unknown>;
                const name = s.name as string | null;
                if (!name) {
                    continue;
                }

                const sharePrefix = `shares.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.stateManager.writeState(`${sharePrefix}.name`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(
                    `${sharePrefix}.freeGb`,
                    { type: 'number', role: 'value', unit: 'GB' },
                    null,
                );
                await this.stateManager.writeState(
                    `${sharePrefix}.usedGb`,
                    { type: 'number', role: 'value', unit: 'GB' },
                    null,
                );
                await this.stateManager.writeState(
                    `${sharePrefix}.sizeGb`,
                    { type: 'number', role: 'value', unit: 'GB' },
                    null,
                );
                await this.stateManager.writeState(
                    `${sharePrefix}.usedPercent`,
                    { type: 'number', role: 'value.percent', unit: '%' },
                    null,
                );
                await this.stateManager.writeState(`${sharePrefix}.comment`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(`${sharePrefix}.allocator`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(`${sharePrefix}.cow`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(`${sharePrefix}.color`, { type: 'string', role: 'text' }, null);
            }
        }

        // Update share values
        for (const share of shares) {
            const s = share as Record<string, unknown>;
            const name = s.name as string | null;
            if (!name || !this.shareNames.has(name)) {
                continue;
            }

            const sharePrefix = `shares.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.stateManager.updateState(`${sharePrefix}.name`, name);
            await this.stateManager.updateState(`${sharePrefix}.freeGb`, kilobytesToGigabytes(s.free));
            await this.stateManager.updateState(`${sharePrefix}.usedGb`, kilobytesToGigabytes(s.used));
            await this.stateManager.updateState(`${sharePrefix}.sizeGb`, kilobytesToGigabytes(s.size));

            // Calculate usage percent
            const usedKb = toNumberOrNull(s.used);
            const freeKb = toNumberOrNull(s.free);
            let usedPercent: number | null = null;
            if (usedKb !== null && freeKb !== null && usedKb + freeKb > 0) {
                usedPercent = Math.round((usedKb / (usedKb + freeKb)) * 10000) / 100;
            }
            await this.stateManager.updateState(`${sharePrefix}.usedPercent`, usedPercent);

            await this.stateManager.updateState(`${sharePrefix}.comment`, toStringOrNull(s.comment));
            await this.stateManager.updateState(`${sharePrefix}.allocator`, toStringOrNull(s.allocator));
            await this.stateManager.updateState(`${sharePrefix}.cow`, toStringOrNull(s.cow));
            await this.stateManager.updateState(`${sharePrefix}.color`, toStringOrNull(s.color));
        }
    }

    /**
     * Handle dynamic VM state creation and updates
     */
    async handleDynamicVms(data: Record<string, unknown>, selectedDomains: Set<string>): Promise<void> {
        if (!selectedDomains.has('vms.list')) {
            return;
        }

        const vms = data.vms as { domains?: unknown[] };
        if (!vms?.domains) {
            return;
        }

        const domains = Array.isArray(vms.domains) ? vms.domains : [];
        const vmUuids = new Set<string>();

        for (const vm of domains) {
            const v = vm as Record<string, unknown>;
            const uuid = v.uuid as string | null;
            if (uuid) {
                vmUuids.add(uuid);
            }
        }

        const needsUpdate =
            !this.vmsDetected ||
            vmUuids.size !== this.vmUuids.size ||
            ![...vmUuids].every(uuid => this.vmUuids.has(uuid));

        if (needsUpdate) {
            this.vmUuids = vmUuids;
            this.vmsDetected = true;

            this.adapter.log.info(`Detected ${vmUuids.size} VMs`);

            await this.stateManager.writeState('vms.count', { type: 'number', role: 'value', unit: '' }, vmUuids.size);

            for (const vm of domains) {
                const v = vm as Record<string, unknown>;
                const name = v.name as string | null;
                const uuid = v.uuid as string | null;
                if (!name || !uuid) {
                    continue;
                }

                const vmPrefix = `vms.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                await this.stateManager.writeState(`${vmPrefix}.name`, { type: 'string', role: 'text' }, null);
                await this.stateManager.writeState(
                    `${vmPrefix}.state`,
                    { type: 'string', role: 'indicator.status' },
                    null,
                );
                await this.stateManager.writeState(`${vmPrefix}.uuid`, { type: 'string', role: 'text' }, null);
            }
        }

        // Update VM values
        for (const vm of domains) {
            const v = vm as Record<string, unknown>;
            const name = v.name as string | null;
            const uuid = v.uuid as string | null;
            if (!name || !uuid || !this.vmUuids.has(uuid)) {
                continue;
            }

            const vmPrefix = `vms.${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            await this.stateManager.updateState(`${vmPrefix}.name`, name);
            await this.stateManager.updateState(`${vmPrefix}.state`, toStringOrNull(v.state));
            await this.stateManager.updateState(`${vmPrefix}.uuid`, uuid);
        }
    }

    private async createDiskStates(prefix: string, disks: unknown[]): Promise<void> {
        for (let i = 0; i < disks.length; i++) {
            const disk = disks[i] as Record<string, unknown>;
            const diskPrefix = `${prefix}.${String(disk.idx ?? i)}`;

            // Basic info states
            await this.stateManager.writeState(`${diskPrefix}.name`, { type: 'string', role: 'text' }, null);
            await this.stateManager.writeState(`${diskPrefix}.device`, { type: 'string', role: 'text' }, null);
            await this.stateManager.writeState(
                `${diskPrefix}.status`,
                { type: 'string', role: 'indicator.status' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.temp`,
                { type: 'number', role: 'value.temperature', unit: '°C' },
                null,
            );
            await this.stateManager.writeState(`${diskPrefix}.type`, { type: 'string', role: 'text' }, null);

            // Size states
            await this.stateManager.writeState(
                `${diskPrefix}.sizeGb`,
                { type: 'number', role: 'value', unit: 'GB' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.fsSizeGb`,
                { type: 'number', role: 'value', unit: 'GB' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.fsUsedGb`,
                { type: 'number', role: 'value', unit: 'GB' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.fsFreeGb`,
                { type: 'number', role: 'value', unit: 'GB' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.fsUsedPercent`,
                { type: 'number', role: 'value.percent', unit: '%' },
                null,
            );

            // File system info
            await this.stateManager.writeState(`${diskPrefix}.fsType`, { type: 'string', role: 'text' }, null);
            await this.stateManager.writeState(
                `${diskPrefix}.isSpinning`,
                { type: 'boolean', role: 'indicator' },
                null,
            );

            // Performance counters
            await this.stateManager.writeState(`${diskPrefix}.numReads`, { type: 'number', role: 'value' }, null);
            await this.stateManager.writeState(`${diskPrefix}.numWrites`, { type: 'number', role: 'value' }, null);
            await this.stateManager.writeState(`${diskPrefix}.numErrors`, { type: 'number', role: 'value' }, null);

            // Temperature thresholds
            await this.stateManager.writeState(
                `${diskPrefix}.warning`,
                { type: 'number', role: 'value.temperature', unit: '°C' },
                null,
            );
            await this.stateManager.writeState(
                `${diskPrefix}.critical`,
                { type: 'number', role: 'value.temperature', unit: '°C' },
                null,
            );

            // Additional info
            await this.stateManager.writeState(
                `${diskPrefix}.rotational`,
                { type: 'boolean', role: 'indicator' },
                null,
            );
            await this.stateManager.writeState(`${diskPrefix}.transport`, { type: 'string', role: 'text' }, null);
        }
    }

    private async updateDiskValues(prefix: string, disks: unknown[]): Promise<void> {
        for (const disk of disks) {
            const d = disk as Record<string, unknown>;
            const diskPrefix = `${prefix}.${String(d.idx ?? disks.indexOf(disk))}`;

            await this.stateManager.updateState(`${diskPrefix}.name`, toStringOrNull(d.name));
            await this.stateManager.updateState(`${diskPrefix}.device`, toStringOrNull(d.device));
            await this.stateManager.updateState(`${diskPrefix}.status`, toStringOrNull(d.status));
            await this.stateManager.updateState(`${diskPrefix}.temp`, toNumberOrNull(d.temp));
            await this.stateManager.updateState(`${diskPrefix}.type`, toStringOrNull(d.type));

            await this.stateManager.updateState(`${diskPrefix}.sizeGb`, kilobytesToGigabytes(d.size));
            await this.stateManager.updateState(`${diskPrefix}.fsSizeGb`, kilobytesToGigabytes(d.fsSize));
            await this.stateManager.updateState(`${diskPrefix}.fsUsedGb`, kilobytesToGigabytes(d.fsUsed));
            await this.stateManager.updateState(`${diskPrefix}.fsFreeGb`, kilobytesToGigabytes(d.fsFree));

            const fsUsedPercent = calculateUsagePercent(d.fsUsed, d.fsSize);
            await this.stateManager.updateState(`${diskPrefix}.fsUsedPercent`, fsUsedPercent);

            await this.stateManager.updateState(`${diskPrefix}.fsType`, toStringOrNull(d.fsType));
            await this.stateManager.updateState(`${diskPrefix}.isSpinning`, toBooleanOrNull(d.isSpinning));

            await this.stateManager.updateState(`${diskPrefix}.numReads`, bigIntToNumber(d.numReads));
            await this.stateManager.updateState(`${diskPrefix}.numWrites`, bigIntToNumber(d.numWrites));
            await this.stateManager.updateState(`${diskPrefix}.numErrors`, bigIntToNumber(d.numErrors));

            await this.stateManager.updateState(`${diskPrefix}.warning`, toNumberOrNull(d.warning));
            await this.stateManager.updateState(`${diskPrefix}.critical`, toNumberOrNull(d.critical));

            await this.stateManager.updateState(`${diskPrefix}.rotational`, toBooleanOrNull(d.rotational));
            await this.stateManager.updateState(`${diskPrefix}.transport`, toStringOrNull(d.transport));
        }
    }
}
