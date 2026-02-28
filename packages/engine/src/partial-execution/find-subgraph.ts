import type { INode } from 'n8n-workflow';

import type { GraphConnection } from './directed-graph';
import { DirectedGraph } from './directed-graph';

/**
 * Recursively walk from the destination node backwards toward the trigger,
 * collecting every node and connection on a valid path.
 */
function findSubgraphRecursive(
	graph: DirectedGraph,
	destinationNode: INode,
	current: INode,
	trigger: INode,
	result: DirectedGraph,
	currentBranch: GraphConnection[],
): void {
	// Reached the trigger — keep this branch
	if (current === trigger) {
		result.addNode(trigger);
		for (const conn of currentBranch) {
			result.addNodes(conn.from, conn.to);
			result.addConnection(conn);
		}
		return;
	}

	const parentConns = graph.getDirectParentConnections(current);

	// No parents — dead end, discard branch
	if (parentConns.length === 0) return;

	// Cycle back to destination — discard
	const isCycleWithDest =
		current === destinationNode && currentBranch.some((c) => c.to === destinationNode);
	if (isCycleWithDest) return;

	// Cycle with current node — keep (loop detected)
	const isCycleWithCurrent = currentBranch.some((c) => c.to === current);
	if (isCycleWithCurrent) {
		for (const conn of currentBranch) {
			result.addNodes(conn.from, conn.to);
			result.addConnection(conn);
		}
		return;
	}

	// Recurse on each parent (only main connections for data flow)
	for (const parentConn of parentConns) {
		findSubgraphRecursive(graph, destinationNode, parentConn.from, trigger, result, [
			...currentBranch,
			parentConn,
		]);
	}
}

/**
 * Find all nodes on any path between `trigger` and `destination` in the graph.
 * Returns a new DirectedGraph containing only those nodes and connections.
 */
export function findSubgraph(options: {
	graph: DirectedGraph;
	destination: INode;
	trigger: INode;
}): DirectedGraph {
	const { graph, destination, trigger } = options;
	const subgraph = new DirectedGraph();

	findSubgraphRecursive(graph, destination, destination, trigger, subgraph, []);

	return subgraph;
}
