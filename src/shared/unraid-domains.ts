export interface DomainNode {
    id: DomainId;
    label: string;
    description?: string;
    defaultSelected?: boolean;
    children?: readonly DomainNode[];
}

export type DomainId =
    | 'info'
    | 'info.time'
    | 'info.os'
    | 'server'
    | 'server.status'
    | 'metrics'
    | 'metrics.cpu'
    | 'metrics.memory';

export interface FieldSpec {
    name: string;
    selection?: readonly FieldSpec[];
}

export interface RootSelection {
    root: string;
    fields: readonly FieldSpec[];
}

export type StateValueType = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'mixed';

export interface StateMapping {
    id: string;
    path: readonly string[];
    common: {
        type: StateValueType;
        role: string;
        unit?: string;
    };
    transform?: (value: unknown) => unknown;
}

export interface DomainDefinition {
    id: DomainId;
    selection: readonly RootSelection[];
    states: readonly StateMapping[];
}

const domainTreeDefinition: readonly DomainNode[] = [
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
];

const buildNodeIndex = (
    nodes: readonly DomainNode[],
    acc: Map<DomainId, DomainNode>,
): Map<DomainId, DomainNode> => {
    for (const node of nodes) {
        acc.set(node.id, node);
        if (node.children?.length) {
            buildNodeIndex(node.children, acc);
        }
    }
    return acc;
};

const collectIds = (nodes: readonly DomainNode[], acc: DomainId[] = []): DomainId[] => {
    for (const node of nodes) {
        acc.push(node.id);
        if (node.children?.length) {
            collectIds(node.children, acc);
        }
    }
    return acc;
};

const collectDefaultIds = (nodes: readonly DomainNode[], acc: DomainId[] = []): DomainId[] => {
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

const buildAncestorIndex = (
    nodes: readonly DomainNode[],
    parentId: DomainId | undefined,
    acc: Map<DomainId, DomainId[]>,
): Map<DomainId, DomainId[]> => {
    for (const node of nodes) {
        const ancestors = parentId ? [...(acc.get(parentId) ?? []), parentId] : [];
        acc.set(node.id, ancestors);
        if (node.children?.length) {
            buildAncestorIndex(node.children, node.id, acc);
        }
    }
    return acc;
};

export const domainTree = domainTreeDefinition;
export const domainNodeById = buildNodeIndex(domainTreeDefinition, new Map<DomainId, DomainNode>());
export const allDomainIds = Object.freeze(collectIds(domainTreeDefinition));
export const defaultEnabledDomains = Object.freeze(collectDefaultIds(domainTreeDefinition));

const ancestorIndex = buildAncestorIndex(domainTreeDefinition, undefined, new Map<DomainId, DomainId[]>());

export const getDomainAncestors = (id: DomainId): readonly DomainId[] => ancestorIndex.get(id) ?? [];

const domainDefinitionsList: readonly DomainDefinition[] = [
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
];

function numberOrNull(value: unknown): number | null {
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

function bytesToGigabytes(value: unknown): number | null {
    const numeric = numberOrNull(value);
    if (numeric === null) {
        return null;
    }
    const gigabytes = numeric / (1024 * 1024 * 1024);
    return Number.isFinite(gigabytes) ? gigabytes : null;
}

export const domainDefinitions = domainDefinitionsList;

export const domainDefinitionById = new Map<DomainId, DomainDefinition>(
    domainDefinitionsList.map((definition) => [definition.id, definition]),
);

export const collectNodeIds = (node: DomainNode): readonly DomainId[] => {
    const ids: DomainId[] = [node.id];
    if (node.children?.length) {
        for (const child of node.children) {
            ids.push(...collectNodeIds(child));
        }
    }
    return ids;
};

const collectSelectable = (node: DomainNode, acc: Set<DomainId>): void => {
    if (domainDefinitionById.has(node.id)) {
        acc.add(node.id);
    }
    if (node.children?.length) {
        for (const child of node.children) {
            collectSelectable(child, acc);
        }
    }
};

export const expandSelection = (selection: Iterable<DomainId>): Set<DomainId> => {
    const result = new Set<DomainId>();
    for (const id of selection) {
        const node = domainNodeById.get(id);
        if (!node) {
            continue;
        }
        collectSelectable(node, result);
    }
    return result;
};
