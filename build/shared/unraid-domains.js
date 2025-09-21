"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandSelection = exports.collectNodeIds = exports.domainDefinitionById = exports.domainDefinitions = exports.getDomainAncestors = exports.defaultEnabledDomains = exports.allDomainIds = exports.domainNodeById = exports.domainTree = void 0;
const domainTreeDefinition = [
    {
        id: 'info',
        label: 'domains.info',
        children: [
            {
                id: 'info.time',
                label: 'domains.info.time',
                defaultSelected: true,
            },
            {
                id: 'info.os',
                label: 'domains.info.os',
            },
        ],
    },
    {
        id: 'server',
        label: 'domains.server',
        children: [
            {
                id: 'server.status',
                label: 'domains.server.status',
                defaultSelected: true,
            },
        ],
    },
    {
        id: 'metrics',
        label: 'domains.metrics',
        children: [
            {
                id: 'metrics.cpu',
                label: 'domains.metrics.cpu',
                defaultSelected: true,
            },
            {
                id: 'metrics.memory',
                label: 'domains.metrics.memory',
                defaultSelected: true,
            },
        ],
    },
    {
        id: 'array',
        label: 'domains.array',
        children: [
            {
                id: 'array.status',
                label: 'domains.array.status',
                defaultSelected: true,
            },
            {
                id: 'array.disks',
                label: 'domains.array.disks',
                defaultSelected: true,
            },
            {
                id: 'array.parities',
                label: 'domains.array.parities',
                defaultSelected: false,
            },
            {
                id: 'array.caches',
                label: 'domains.array.caches',
                defaultSelected: false,
            },
        ],
    },
];
const buildNodeIndex = (nodes, acc) => {
    for (const node of nodes) {
        acc.set(node.id, node);
        if (node.children?.length) {
            buildNodeIndex(node.children, acc);
        }
    }
    return acc;
};
const collectIds = (nodes, acc = []) => {
    for (const node of nodes) {
        acc.push(node.id);
        if (node.children?.length) {
            collectIds(node.children, acc);
        }
    }
    return acc;
};
const collectDefaultIds = (nodes, acc = []) => {
    for (const node of nodes) {
        if (node.defaultSelected) {
            acc.push(node.id);
        }
        if (node.children?.length) {
            collectDefaultIds(node.children, acc);
        }
    }
    return acc;
};
const buildAncestorIndex = (nodes, parentId, acc) => {
    for (const node of nodes) {
        const ancestors = parentId ? [...(acc.get(parentId) ?? []), parentId] : [];
        acc.set(node.id, ancestors);
        if (node.children?.length) {
            buildAncestorIndex(node.children, node.id, acc);
        }
    }
    return acc;
};
exports.domainTree = domainTreeDefinition;
exports.domainNodeById = buildNodeIndex(domainTreeDefinition, new Map());
exports.allDomainIds = Object.freeze(collectIds(domainTreeDefinition));
exports.defaultEnabledDomains = Object.freeze(collectDefaultIds(domainTreeDefinition));
const ancestorIndex = buildAncestorIndex(domainTreeDefinition, undefined, new Map());
const getDomainAncestors = (id) => ancestorIndex.get(id) ?? [];
exports.getDomainAncestors = getDomainAncestors;
const domainDefinitionsList = [
    {
        id: 'info.time',
        selection: [
            {
                root: 'info',
                fields: [{ name: 'time' }],
            },
        ],
        states: [
            {
                id: 'info.time',
                path: ['info', 'time'],
                common: { type: 'string', role: 'value.datetime' },
            },
        ],
    },
    {
        id: 'info.os',
        selection: [
            {
                root: 'info',
                fields: [
                    {
                        name: 'os',
                        selection: [
                            { name: 'distro' },
                            { name: 'release' },
                            { name: 'kernel' },
                        ],
                    },
                ],
            },
        ],
        states: [
            {
                id: 'info.os.distro',
                path: ['info', 'os', 'distro'],
                common: { type: 'string', role: 'text' },
            },
            {
                id: 'info.os.release',
                path: ['info', 'os', 'release'],
                common: { type: 'string', role: 'info.version' },
            },
            {
                id: 'info.os.kernel',
                path: ['info', 'os', 'kernel'],
                common: { type: 'string', role: 'info.version' },
            },
        ],
    },
    {
        id: 'server.status',
        selection: [
            {
                root: 'server',
                fields: [
                    { name: 'name' },
                    { name: 'status' },
                    { name: 'lanip' },
                    { name: 'wanip' },
                    { name: 'localurl' },
                    { name: 'remoteurl' },
                ],
            },
        ],
        states: [
            {
                id: 'server.name',
                path: ['server', 'name'],
                common: { type: 'string', role: 'text' },
            },
            {
                id: 'server.status',
                path: ['server', 'status'],
                common: { type: 'string', role: 'indicator.status' },
            },
            {
                id: 'server.lanip',
                path: ['server', 'lanip'],
                common: { type: 'string', role: 'info.ip' },
            },
            {
                id: 'server.wanip',
                path: ['server', 'wanip'],
                common: { type: 'string', role: 'info.ip' },
            },
            {
                id: 'server.localurl',
                path: ['server', 'localurl'],
                common: { type: 'string', role: 'url' },
            },
            {
                id: 'server.remoteurl',
                path: ['server', 'remoteurl'],
                common: { type: 'string', role: 'url' },
            },
        ],
    },
    {
        id: 'metrics.cpu',
        selection: [
            {
                root: 'metrics',
                fields: [
                    {
                        name: 'cpu',
                        selection: [
                            { name: 'percentTotal' },
                            {
                                name: 'cpus',
                                selection: [
                                    { name: 'percentTotal' },
                                    { name: 'percentUser' },
                                    { name: 'percentSystem' },
                                    { name: 'percentNice' },
                                    { name: 'percentIdle' },
                                    { name: 'percentIrq' },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        states: [
            {
                id: 'metrics.cpu.percentTotal',
                path: ['metrics', 'cpu', 'percentTotal'],
                common: { type: 'number', role: 'value.percent', unit: '%' },
                transform: numberOrNull,
            },
            // Note: CPU core states are created dynamically in main.ts
        ],
    },
    {
        id: 'metrics.memory',
        selection: [
            {
                root: 'metrics',
                fields: [
                    {
                        name: 'memory',
                        selection: [
                            { name: 'percentTotal' },
                            { name: 'total' },
                            { name: 'used' },
                            { name: 'free' },
                            { name: 'available' },
                            { name: 'active' },
                            { name: 'buffcache' },
                            { name: 'swapTotal' },
                            { name: 'swapUsed' },
                            { name: 'swapFree' },
                            { name: 'percentSwapTotal' },
                        ],
                    },
                ],
            },
        ],
        states: [
            {
                id: 'metrics.memory.percentTotal',
                path: ['metrics', 'memory', 'percentTotal'],
                common: { type: 'number', role: 'value.percent', unit: '%' },
                transform: numberOrNull,
            },
            {
                id: 'metrics.memory.totalGb',
                path: ['metrics', 'memory', 'total'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.usedGb',
                path: ['metrics', 'memory', 'used'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.freeGb',
                path: ['metrics', 'memory', 'free'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.availableGb',
                path: ['metrics', 'memory', 'available'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.activeGb',
                path: ['metrics', 'memory', 'active'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.buffcacheGb',
                path: ['metrics', 'memory', 'buffcache'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.swap.totalGb',
                path: ['metrics', 'memory', 'swapTotal'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.swap.usedGb',
                path: ['metrics', 'memory', 'swapUsed'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.swap.freeGb',
                path: ['metrics', 'memory', 'swapFree'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: bytesToGigabytes,
            },
            {
                id: 'metrics.memory.swap.percentTotal',
                path: ['metrics', 'memory', 'percentSwapTotal'],
                common: { type: 'number', role: 'value.percent', unit: '%' },
                transform: numberOrNull,
            },
        ],
    },
    {
        id: 'array.status',
        selection: [
            {
                root: 'array',
                fields: [
                    { name: 'state' },
                    {
                        name: 'capacity',
                        selection: [
                            {
                                name: 'kilobytes',
                                selection: [
                                    { name: 'total' },
                                    { name: 'used' },
                                    { name: 'free' },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        states: [
            {
                id: 'array.state',
                path: ['array', 'state'],
                common: { type: 'string', role: 'indicator.status' },
            },
            {
                id: 'array.capacity.totalGb',
                path: ['array', 'capacity', 'kilobytes', 'total'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: kilobytesToGigabytes,
            },
            {
                id: 'array.capacity.usedGb',
                path: ['array', 'capacity', 'kilobytes', 'used'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: kilobytesToGigabytes,
            },
            {
                id: 'array.capacity.freeGb',
                path: ['array', 'capacity', 'kilobytes', 'free'],
                common: { type: 'number', role: 'value', unit: 'GB' },
                transform: kilobytesToGigabytes,
            },
            {
                id: 'array.capacity.percentUsed',
                path: ['array', 'capacity'],
                common: { type: 'number', role: 'value.percent', unit: '%' },
                transform: (value) => {
                    if (!value || typeof value !== 'object')
                        return null;
                    const capacity = value;
                    const kilobytes = capacity.kilobytes;
                    const total = numberOrNull(kilobytes?.total);
                    const used = numberOrNull(kilobytes?.used);
                    if (total && used && total > 0) {
                        return Math.round((used / total) * 10000) / 100;
                    }
                    return null;
                },
            },
        ],
    },
    {
        id: 'array.disks',
        selection: [
            {
                root: 'array',
                fields: [
                    {
                        name: 'disks',
                        selection: [
                            { name: 'name' },
                            { name: 'device' },
                            { name: 'status' },
                            { name: 'temp' },
                            { name: 'type' },
                            { name: 'size' },
                            { name: 'fsType' },
                            { name: 'fsSize' },
                            { name: 'fsUsed' },
                            { name: 'fsFree' },
                            { name: 'isSpinning' },
                            { name: 'numReads' },
                            { name: 'numWrites' },
                            { name: 'numErrors' },
                            { name: 'warning' },
                            { name: 'critical' },
                            { name: 'idx' },
                            { name: 'rotational' },
                            { name: 'transport' },
                        ],
                    },
                ],
            },
        ],
        states: [
        // Note: Disk states are created dynamically in main.ts
        ],
    },
    {
        id: 'array.parities',
        selection: [
            {
                root: 'array',
                fields: [
                    {
                        name: 'parities',
                        selection: [
                            { name: 'name' },
                            { name: 'device' },
                            { name: 'status' },
                            { name: 'temp' },
                            { name: 'type' },
                            { name: 'size' },
                            { name: 'fsType' },
                            { name: 'fsSize' },
                            { name: 'fsUsed' },
                            { name: 'fsFree' },
                            { name: 'isSpinning' },
                            { name: 'numReads' },
                            { name: 'numWrites' },
                            { name: 'numErrors' },
                            { name: 'warning' },
                            { name: 'critical' },
                            { name: 'idx' },
                            { name: 'rotational' },
                            { name: 'transport' },
                        ],
                    },
                ],
            },
        ],
        states: [
        // Note: Parity states are created dynamically in main.ts
        ],
    },
    {
        id: 'array.caches',
        selection: [
            {
                root: 'array',
                fields: [
                    {
                        name: 'caches',
                        selection: [
                            { name: 'name' },
                            { name: 'device' },
                            { name: 'status' },
                            { name: 'temp' },
                            { name: 'type' },
                            { name: 'size' },
                            { name: 'fsType' },
                            { name: 'fsSize' },
                            { name: 'fsUsed' },
                            { name: 'fsFree' },
                            { name: 'isSpinning' },
                            { name: 'numReads' },
                            { name: 'numWrites' },
                            { name: 'numErrors' },
                            { name: 'warning' },
                            { name: 'critical' },
                            { name: 'idx' },
                            { name: 'rotational' },
                            { name: 'transport' },
                        ],
                    },
                ],
            },
        ],
        states: [
        // Note: Cache states are created dynamically in main.ts
        ],
    },
];
function numberOrNull(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'bigint') {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    return null;
}
function bytesToGigabytes(value) {
    const numeric = numberOrNull(value);
    if (numeric === null) {
        return null;
    }
    const gigabytes = numeric / (1024 * 1024 * 1024);
    return Number.isFinite(gigabytes) ? gigabytes : null;
}
function kilobytesToGigabytes(value) {
    const numeric = numberOrNull(value);
    if (numeric === null) {
        return null;
    }
    const gigabytes = numeric / (1024 * 1024);
    return Number.isFinite(gigabytes) ? Math.round(gigabytes * 100) / 100 : null;
}
exports.domainDefinitions = domainDefinitionsList;
exports.domainDefinitionById = new Map(domainDefinitionsList.map((definition) => [definition.id, definition]));
const collectNodeIds = (node) => {
    const ids = [node.id];
    if (node.children?.length) {
        for (const child of node.children) {
            ids.push(...(0, exports.collectNodeIds)(child));
        }
    }
    return ids;
};
exports.collectNodeIds = collectNodeIds;
const collectSelectable = (node, acc) => {
    if (exports.domainDefinitionById.has(node.id)) {
        acc.add(node.id);
    }
    if (node.children?.length) {
        for (const child of node.children) {
            collectSelectable(child, acc);
        }
    }
};
const expandSelection = (selection) => {
    const result = new Set();
    for (const id of selection) {
        const node = exports.domainNodeById.get(id);
        if (!node) {
            continue;
        }
        collectSelectable(node, result);
    }
    return result;
};
exports.expandSelection = expandSelection;
//# sourceMappingURL=unraid-domains.js.map