import type { INode } from 'n8n-workflow';

import type { DirectedGraph } from './directed-graph';

/**
 * For every start node that is part of a cycle, replace it with the first
 * node of that cycle reachable from the trigger. This prevents executing
 * cycles partially.
 */
export function handleCycles(
	graph: DirectedGraph,
	startNodes: Set<INode>,
	trigger: INode,
): Set<INode> {
	// SCCs of size 1 are not cycles (a node is trivially its own SCC)
	const cycles = graph.getStronglyConnectedComponents().filter((scc) => scc.size > 1);

	if (cycles.length === 0) return new Set(startNodes);

	const result = new Set(startNodes);

	for (const startNode of startNodes) {
		for (const cycle of cycles) {
			if (!cycle.has(startNode)) continue;

			// Find the first node of this cycle reachable from trigger
			const firstNode = graph.depthFirstSearch({
				from: trigger,
				fn: (node) => cycle.has(node),
			});

			if (firstNode) {
				result.delete(startNode);
				result.add(firstNode);
			}
		}
	}

	return result;
}

/**
 * Detect all cycles in the graph.
 * Returns an array of cycles, where each cycle is an array of node names.
 */
export function detectCycles(graph: DirectedGraph): string[][] {
	const sccs = graph.getStronglyConnectedComponents();
	const cycles: string[][] = [];

	for (const scc of sccs) {
		// Single-node SCCs are not cycles unless the node has a self-loop
		if (scc.size === 1) {
			const node = [...scc][0];
			const hasSelfLoop = graph
				.getDirectChildConnections(node)
				.some((c) => c.to === node);
			if (hasSelfLoop) {
				cycles.push([node.name]);
			}
		} else {
			cycles.push([...scc].map((n) => n.name));
		}
	}

	return cycles;
}
