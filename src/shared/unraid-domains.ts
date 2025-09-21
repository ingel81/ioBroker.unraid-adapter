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
    | 'server.status';

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
];

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
