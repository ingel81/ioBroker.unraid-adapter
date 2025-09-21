import React from 'react';
import { withStyles, createStyles, type WithStyles } from '@material-ui/core/styles';
import TextField, { type TextFieldProps } from '@material-ui/core/TextField';
import Checkbox from '@material-ui/core/Checkbox';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Typography from '@material-ui/core/Typography';
import Divider from '@material-ui/core/Divider';
import I18n from '@iobroker/adapter-react/i18n';

import {
    domainTree,
    collectNodeIds,
    defaultEnabledDomains,
    type DomainNode,
    type DomainId,
    allDomainIds,
    getDomainAncestors,
    domainNodeById,
} from '../../../src/shared/unraid-domains';

const styles = () =>
    createStyles({
        tab: {
            maxWidth: 800,
            padding: 16,
        },
        section: {
            marginBottom: 24,
        },
        sectionHeader: {
            marginBottom: 8,
        },
        input: {
            marginTop: 0,
            width: '100%',
            maxWidth: 600,
        },
        controlElement: {
            marginBottom: 16,
        },
        treeContainer: {
            border: '1px solid #cccccc',
            borderRadius: 4,
            padding: '12px 16px',
            maxHeight: 420,
            overflowY: 'auto',
        },
        treeRow: {
            display: 'flex',
            alignItems: 'center',
            marginBottom: 4,
        },
        treeToggle: {
            width: 28,
            height: 28,
            marginRight: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #cccccc',
            borderRadius: 4,
            padding: 0,
            backgroundColor: 'transparent',
            cursor: 'pointer',
        },
        treeTogglePlaceholder: {
            width: 28,
            height: 28,
            marginRight: 8,
        },
        treeLabel: {
            flexGrow: 1,
        },
        treeChildren: {
            marginLeft: 28,
        },
        treeDescription: {
            marginLeft: 36,
            marginBottom: 8,
        },
    });

type SettingsProps = WithStyles<typeof styles> & {
    native: ioBroker.AdapterConfig;
    onChange: <K extends keyof ioBroker.AdapterConfig>(attr: K, value: ioBroker.AdapterConfig[K]) => void;
};

type SettingsState = {
    expandedDomainIds: Set<string>;
};

const treeOrder = new Map<string, number>();
allDomainIds.forEach((id, index) => treeOrder.set(id, index));

const sortByTreeOrder = (ids: Iterable<DomainId>): DomainId[] => {
    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.sort((left, right) => {
        const leftIndex = treeOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = treeOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
};

const isNodeFullySelected = (node: DomainNode, selection: Set<DomainId>): boolean => {
    if (!selection.has(node.id)) {
        return false;
    }

    if (!node.children?.length) {
        return true;
    }

    return node.children.every((child) => isNodeFullySelected(child, selection));
};

const nodeHasSelectedDescendant = (node: DomainNode, selection: Set<DomainId>): boolean => {
    if (selection.has(node.id)) {
        return true;
    }

    if (!node.children?.length) {
        return false;
    }

    return node.children.some((child) => nodeHasSelectedDescendant(child, selection));
};

const isNodePartiallySelected = (node: DomainNode, selection: Set<DomainId>): boolean => {
    if (!node.children?.length) {
        return false;
    }

    const descendantSelected = node.children.some((child) => nodeHasSelectedDescendant(child, selection));
    if (!descendantSelected) {
        return false;
    }

    return !isNodeFullySelected(node, selection);
};

class Settings extends React.Component<SettingsProps, SettingsState> {
    public constructor(props: SettingsProps) {
        super(props);

        const expandable = new Set<string>();
        for (const node of domainTree) {
            if (node.children?.length) {
                expandable.add(node.id);
            }
        }

        this.state = {
            expandedDomainIds: expandable,
        };
    }

    private renderInput<K extends keyof ioBroker.AdapterConfig>(
        title: AdminWord,
        attr: K,
        type: TextFieldProps['type'],
        additionalProps: Partial<TextFieldProps> = {},
    ): React.ReactNode {
        const { classes, native } = this.props;
        const currentValue = native[attr];
        const value = typeof currentValue === 'string' ? currentValue : '';

        return (
            <TextField
                label={I18n.t(title)}
                className={`${classes.input} ${classes.controlElement}`}
                value={value}
                type={type ?? 'text'}
                onChange={(event) => {
                    const nextValue = event.target.value;
                    this.props.onChange(attr, nextValue as ioBroker.AdapterConfig[K]);
                }}
                margin="normal"
                fullWidth
                {...additionalProps}
            />
        );
    }

    private renderPollInterval(): React.ReactNode {
        const { classes, native } = this.props;
        const value = typeof native.pollIntervalSeconds === 'number' ? native.pollIntervalSeconds : 60;

        return (
            <TextField
                label={I18n.t('pollIntervalSeconds')}
                className={`${classes.input} ${classes.controlElement}`}
                value={value}
                type="number"
                inputProps={{ min: 5, step: 5 }}
                onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const sanitized = Number.isFinite(parsed) ? Math.floor(parsed) : value;
                    const nextValue = Math.max(5, sanitized || 0);
                    this.props.onChange('pollIntervalSeconds', nextValue);
                }}
                helperText={I18n.t('pollIntervalSeconds_help')}
                margin="normal"
                fullWidth
            />
        );
    }

    private toggleDomainExpansion = (id: string): void => {
        this.setState((prev) => {
            const next = new Set(prev.expandedDomainIds);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return { expandedDomainIds: next };
        });
    };

    private handleDomainToggle = (node: DomainNode, shouldSelect: boolean): void => {
        const currentRaw = Array.isArray(this.props.native.enabledDomains)
            ? (this.props.native.enabledDomains as string[])
            : [...defaultEnabledDomains];
        const current: DomainId[] = currentRaw.filter((id): id is DomainId => domainNodeById.has(id as DomainId));
        const next = new Set<DomainId>(current);
        const affectedIds = collectNodeIds(node);

        if (shouldSelect) {
            affectedIds.forEach((id) => next.add(id));
            getDomainAncestors(node.id).forEach((ancestorId) => next.add(ancestorId));
        } else {
            affectedIds.forEach((id) => next.delete(id));
            this.pruneAncestors(node.id, next);
        }

        this.props.onChange('enabledDomains', sortByTreeOrder(next));
    };

    private pruneAncestors(domainId: DomainId, selection: Set<DomainId>): void {
        const ancestors = getDomainAncestors(domainId);

        for (const ancestorId of ancestors) {
            if (selection.has(ancestorId)) {
                const ancestorNode = domainNodeById.get(ancestorId);
                if (!ancestorNode) {
                    continue;
                }

                const descendantIds = collectNodeIds(ancestorNode).filter((id) => id !== ancestorId);
                const hasSelectedDescendant = descendantIds.some((id) => selection.has(id));
                if (!hasSelectedDescendant) {
                    selection.delete(ancestorId);
                }
            }
        }
    }

    private renderDomainNode(node: DomainNode, depth: number, selection: Set<DomainId>): React.ReactNode {
        const { classes } = this.props;
        const hasChildren = !!node.children?.length;
        const isExpanded = this.state.expandedDomainIds.has(node.id);
        const isChecked = isNodeFullySelected(node, selection);
        const isIndeterminate = isNodePartiallySelected(node, selection);

        return (
            <React.Fragment key={node.id}>
                <div className={classes.treeRow} style={{ paddingLeft: depth * 20 }}>
                    {hasChildren ? (
                        <button
                            type="button"
                            className={classes.treeToggle}
                            onClick={() => this.toggleDomainExpansion(node.id)}
                            aria-label={isExpanded ? I18n.t('collapseNode') : I18n.t('expandNode')}
                        >
                            {isExpanded ? '-' : '+'}
                        </button>
                    ) : (
                        <span className={classes.treeTogglePlaceholder} />
                    )}
                    <FormControlLabel
                        className={classes.treeLabel}
                        control={
                            <Checkbox
                                color="primary"
                                checked={isChecked}
                                indeterminate={isIndeterminate}
                                onChange={(event, checked) => this.handleDomainToggle(node, checked)}
                            />
                        }
                        label={I18n.t(node.label as AdminWord)}
                    />
                </div>
                {node.description ? (
                    <Typography variant="caption" color="textSecondary" className={classes.treeDescription}>
                        {I18n.t(node.description as AdminWord)}
                    </Typography>
                ) : null}
                {hasChildren && isExpanded ? (
                    <div className={classes.treeChildren}>
                        {node.children!.map((child) => this.renderDomainNode(child, depth + 1, selection))}
                    </div>
                ) : null}
            </React.Fragment>
        );
    }

    public render(): React.ReactNode {
        const { classes, native } = this.props;
        const enabledDomainsArrayRaw = Array.isArray(native.enabledDomains)
            ? (native.enabledDomains as string[])
            : [...defaultEnabledDomains];
        const enabledDomainsArray: DomainId[] = enabledDomainsArrayRaw.filter((id): id is DomainId =>
            domainNodeById.has(id as DomainId),
        );
        const selection = new Set<DomainId>(enabledDomainsArray);

        return (
            <form className={classes.tab}>
                <div className={classes.section}>
                    <Typography variant="h6" className={classes.sectionHeader}>
                        {I18n.t('section.connection')}
                    </Typography>
                    {this.renderInput('baseUrl', 'baseUrl', 'text', {
                        required: true,
                        helperText: I18n.t('baseUrl_help'),
                    })}
                    {this.renderInput('apiToken', 'apiToken', 'password', {
                        required: true,
                        helperText: I18n.t('apiToken_help'),
                        autoComplete: 'off',
                    })}
                    <FormControlLabel
                        className={classes.controlElement}
                        control={
                            <Checkbox
                                color="primary"
                                checked={!!native.allowSelfSigned}
                                onChange={(event, checked) => this.props.onChange('allowSelfSigned', checked)}
                            />
                        }
                        label={I18n.t('allowSelfSigned')}
                    />
                    <Typography variant="caption" color="textSecondary" className={classes.controlElement}>
                        {I18n.t('allowSelfSigned_help')}
                    </Typography>
                </div>

                <Divider />

                <div className={classes.section}>
                    <Typography variant="h6" className={classes.sectionHeader}>
                        {I18n.t('section.polling')}
                    </Typography>
                    {this.renderPollInterval()}
                </div>

                <Divider />

                <div className={classes.section}>
                    <Typography variant="h6" className={classes.sectionHeader}>
                        {I18n.t('section.domains')}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" className={classes.controlElement}>
                        {I18n.t('enabledDomains_help')}
                    </Typography>
                    <div className={classes.treeContainer}>
                        {domainTree.map((node) => this.renderDomainNode(node, 0, selection))}
                    </div>
                </div>
            </form>
        );
    }
}

export default withStyles(styles)(Settings);
