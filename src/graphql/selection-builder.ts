import type { RootSelection, FieldSpec } from '../shared/unraid-domains';

/**
 * Recursive tree structure for GraphQL field selections
 */
type FieldNode = Map<string, FieldNode>;

/**
 * Builder class for constructing GraphQL selection queries.
 * Merges multiple domain selections into a single optimized query.
 */
export class GraphQLSelectionBuilder {
    private readonly roots = new Map<string, FieldNode>();

    /**
     * Add multiple root selections to the query builder
     *
     * @param selections - Array of root selections to add
     */
    public addSelections(selections: readonly RootSelection[]): void {
        for (const selection of selections) {
            if (!selection.fields.length) {
                continue;
            }
            const rootNode = this.getOrCreateRoot(selection.root);
            this.addFields(rootNode, selection.fields);
        }
    }

    /**
     * Build the complete GraphQL query string
     *
     * @returns The formatted GraphQL query or null if no selections
     */
    public build(): string | null {
        if (!this.roots.size) {
            return null;
        }

        const sections: string[] = [];
        const sortedRoots = Array.from(this.roots.keys()).sort((left, right) => left.localeCompare(right));

        for (const root of sortedRoots) {
            const node = this.roots.get(root);
            if (!node) {
                continue;
            }
            const body = this.printNode(node, 8);
            const section = body ? `    ${root} {\n${body}\n    }` : `    ${root}`;
            sections.push(section);
        }

        const queryBody = sections.join('\n');
        return `query UnraidAdapterFetch {\n${queryBody}\n}`;
    }

    /**
     * Get or create a root node in the selection tree
     *
     * @param root - Name of the root field
     * @returns The field node for the root
     */
    private getOrCreateRoot(root: string): FieldNode {
        const existing = this.roots.get(root);
        if (existing) {
            return existing;
        }
        const node: FieldNode = new Map();
        this.roots.set(root, node);
        return node;
    }

    /**
     * Recursively add field specifications to a target node
     *
     * @param target - Target node to add fields to
     * @param fields - Field specifications to add
     */
    private addFields(target: FieldNode, fields: readonly FieldSpec[]): void {
        for (const field of fields) {
            let child = target.get(field.name);
            if (!child) {
                child = new Map();
                target.set(field.name, child);
            }
            if (field.selection?.length) {
                this.addFields(child, field.selection);
            }
        }
    }

    /**
     * Recursively print a field node tree as GraphQL syntax
     *
     * @param node - Node to print
     * @param indent - Current indentation level
     * @returns Formatted GraphQL selection string
     */
    private printNode(node: FieldNode, indent: number): string {
        if (!node.size) {
            return '';
        }

        const indentString = ' '.repeat(indent);
        const entries = Array.from(node.entries()).sort((left, right) => left[0].localeCompare(right[0]));

        return entries
            .map(([name, child]) => {
                if (!child.size) {
                    return `${indentString}${name}`;
                }
                const body = this.printNode(child, indent + 4);
                if (!body) {
                    return `${indentString}${name}`;
                }
                return `${indentString}${name} {\n${body}\n${indentString}}`;
            })
            .join('\n');
    }
}
