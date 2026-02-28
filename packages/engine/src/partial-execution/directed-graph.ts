import type { IConnections, INode, NodeConnectionType } from 'n8n-workflow';

export interface GraphConnection {
	from: INode;
	to: INode;
	type: NodeConnectionType;
	outputIndex: number;
	inputIndex: number;
}

// fromName-type-outputIndex-inputIndex-toName
type ConnectionKey = `${string}-${string}-${number}-${number}-${string}`;

/**
 * Directed graph representation of workflow connections.
 *
 * The Workflow class stores connections in a deeply nested normalized format
 * that is hard to traverse and edit. This class provides a flat adjacency-list
 * representation with import/export helpers.
 */
export class DirectedGraph {
	private nodes: Map<string, INode> = new Map();
	private connections: Map<ConnectionKey, GraphConnection> = new Map();

	// -- Factories ----------------------------------------------------------

	static fromNodesAndConnections(nodes: INode[], connections: IConnections): DirectedGraph {
		const graph = new DirectedGraph();

		graph.addNodes(...nodes);

		for (const [fromName, outputs] of Object.entries(connections)) {
			const from = graph.nodes.get(fromName);
			if (!from) continue;

			for (const [type, outputArr] of Object.entries(outputs)) {
				if (!outputArr) continue;
				for (let outputIndex = 0; outputIndex < outputArr.length; outputIndex++) {
					const conns = outputArr[outputIndex];
					if (!conns) continue;

					for (const conn of conns) {
						const to = graph.nodes.get(conn.node);
						if (!to) continue;

						graph.addConnection({
							from,
							to,
							type: type as NodeConnectionType,
							outputIndex,
							inputIndex: conn.index,
						});
					}
				}
			}
		}

		return graph;
	}

	// -- Mutation -----------------------------------------------------------

	addNode(node: INode): this {
		this.nodes.set(node.name, node);
		return this;
	}

	addNodes(...nodes: INode[]): this {
		for (const node of nodes) {
			this.addNode(node);
		}
		return this;
	}

	addConnection(conn: GraphConnection): this {
		this.connections.set(this.makeKey(conn), conn);
		return this;
	}

	addConnections(
		...conns: Array<{
			from: INode;
			to: INode;
			type?: NodeConnectionType;
			outputIndex?: number;
			inputIndex?: number;
		}>
	): this {
		for (const c of conns) {
			this.addConnection({
				from: c.from,
				to: c.to,
				type: c.type ?? ('main' as NodeConnectionType),
				outputIndex: c.outputIndex ?? 0,
				inputIndex: c.inputIndex ?? 0,
			});
		}
		return this;
	}

	// -- Queries ------------------------------------------------------------

	hasNode(name: string): boolean {
		return this.nodes.has(name);
	}

	getNode(name: string): INode | undefined {
		return this.nodes.get(name);
	}

	getNodes(): Map<string, INode> {
		return new Map(this.nodes.entries());
	}

	getConnections(filter: { to?: INode } = {}): GraphConnection[] {
		const result: GraphConnection[] = [];
		for (const conn of this.connections.values()) {
			if (filter.to && conn.to !== filter.to) continue;
			result.push(conn);
		}
		return result;
	}

	getDirectParentConnections(node: INode): GraphConnection[] {
		const result: GraphConnection[] = [];
		for (const conn of this.connections.values()) {
			if (conn.to === node) result.push(conn);
		}
		return result;
	}

	getDirectChildConnections(node: INode): GraphConnection[] {
		const result: GraphConnection[] = [];
		for (const conn of this.connections.values()) {
			if (conn.from === node) result.push(conn);
		}
		return result;
	}

	getParentConnections(node: INode): Set<GraphConnection> {
		return this.getParentConnectionsRecursive(node, new Set());
	}

	getChildren(node: INode): Set<INode> {
		return this.getChildrenRecursive(node, new Set());
	}

	/**
	 * Tarjan's algorithm for strongly connected components.
	 * Returns every SCC including singletons.
	 */
	getStronglyConnectedComponents(): Array<Set<INode>> {
		let id = 0;
		const visited = new Set<INode>();
		const ids = new Map<INode, number>();
		const lowLink = new Map<INode, number>();
		const stack: INode[] = [];
		const sccs: Array<Set<INode>> = [];

		const visit = (node: INode) => {
			if (visited.has(node)) return;

			visited.add(node);
			lowLink.set(node, id);
			ids.set(node, id);
			id++;
			stack.push(node);

			for (const child of this.getDirectChildConnections(node).map((c) => c.to)) {
				visit(child);

				if (stack.includes(child)) {
					const childLow = lowLink.get(child)!;
					const ownLow = lowLink.get(node)!;
					lowLink.set(node, Math.min(childLow, ownLow));
				}
			}

			const ownId = ids.get(node)!;
			const ownLow = lowLink.get(node)!;

			if (ownId === ownLow) {
				const scc: Set<INode> = new Set();
				let next = stack.at(-1);

				while (next && lowLink.get(next) === ownId) {
					stack.pop();
					scc.add(next);
					next = stack.at(-1);
				}

				if (scc.size > 0) sccs.push(scc);
			}
		};

		for (const node of this.nodes.values()) {
			visit(node);
		}

		return sccs;
	}

	/**
	 * Depth-first search starting from `from`. Returns first node
	 * for which `fn` returns true, or undefined.
	 */
	depthFirstSearch({ from, fn }: { from: INode; fn: (node: INode) => boolean }): INode | undefined {
		return this.dfsRecursive(from, fn, new Set());
	}

	// -- Export -------------------------------------------------------------

	toIConnections(): IConnections {
		const result: IConnections = {};

		for (const conn of this.connections.values()) {
			const { from, to, type, outputIndex, inputIndex } = conn;

			result[from.name] = result[from.name] ?? { [type]: [] };
			const rc = result[from.name];
			rc[type] = rc[type] ?? [];
			rc[type][outputIndex] = rc[type][outputIndex] ?? [];
			rc[type][outputIndex].push({
				node: to.name,
				type,
				index: inputIndex,
			});
		}

		return result;
	}

	// -- Private helpers ----------------------------------------------------

	private makeKey(conn: GraphConnection): ConnectionKey {
		return `${conn.from.name}-${conn.type}-${conn.outputIndex}-${conn.inputIndex}-${conn.to.name}`;
	}

	private getChildrenRecursive(node: INode, children: Set<INode>): Set<INode> {
		for (const conn of this.getDirectChildConnections(node)) {
			if (children.has(conn.to)) continue;
			children.add(conn.to);
			this.getChildrenRecursive(conn.to, children);
		}
		return children;
	}

	private getParentConnectionsRecursive(
		node: INode,
		seen: Set<GraphConnection>,
	): Set<GraphConnection> {
		for (const conn of this.getDirectParentConnections(node)) {
			if (seen.has(conn)) continue;
			seen.add(conn);
			this.getParentConnectionsRecursive(conn.from, seen);
		}
		return seen;
	}

	private dfsRecursive(
		node: INode,
		fn: (node: INode) => boolean,
		seen: Set<INode>,
	): INode | undefined {
		if (seen.has(node)) return undefined;
		seen.add(node);

		if (fn(node)) return node;

		for (const conn of this.getDirectChildConnections(node)) {
			const found = this.dfsRecursive(conn.to, fn, seen);
			if (found) return found;
		}

		return undefined;
	}
}
