import type { INode, IPinData, IRunData } from 'n8n-workflow';

import type { DirectedGraph } from './directed-graph';
import { getIncomingDataFromAnyRun } from './get-incoming-data';

/**
 * A node is dirty if it has neither run data nor pinned data.
 * Future: also dirty if properties changed or parent got disabled.
 */
export function isDirty(node: INode, runData: IRunData = {}, pinData: IPinData = {}): boolean {
	if (pinData[node.name] !== undefined) return false;
	if (runData[node.name]) return false;
	return true;
}

function findStartNodesRecursive(
	graph: DirectedGraph,
	current: INode,
	destination: INode,
	runData: IRunData,
	pinData: IPinData,
	startNodes: Set<INode>,
	seen: Set<INode>,
): Set<INode> {
	// Dirty node = needs execution, this is a start node
	if (isDirty(current, runData, pinData)) {
		startNodes.add(current);
		return startNodes;
	}

	// Destination node always needs re-execution
	if (current === destination) {
		startNodes.add(current);
		return startNodes;
	}

	// Cycle detection — stop
	if (seen.has(current)) return startNodes;

	// Follow each outgoing connection that has data
	const outgoing = graph.getDirectChildConnections(current);
	for (const conn of outgoing) {
		const nodeRunData = getIncomingDataFromAnyRun(
			runData,
			conn.from.name,
			conn.type,
			conn.outputIndex,
		);

		const hasNoRunData =
			nodeRunData === null || nodeRunData === undefined || nodeRunData.data.length === 0;
		const hasNoPinnedData = pinData[conn.from.name] === undefined;
		if (hasNoRunData && hasNoPinnedData) continue;

		findStartNodesRecursive(
			graph,
			conn.to,
			destination,
			runData,
			pinData,
			startNodes,
			new Set(seen).add(current),
		);
	}

	return startNodes;
}

/**
 * Find the nodes from which partial re-execution should start.
 *
 * Traverses from the trigger toward the destination, finding the earliest
 * dirty nodes on every branch.
 */
export function findStartNodes(options: {
	graph: DirectedGraph;
	trigger: INode;
	destination: INode;
	pinData: IPinData;
	runData: IRunData;
}): Set<INode> {
	const { graph, trigger, destination, runData, pinData } = options;

	return findStartNodesRecursive(
		graph,
		trigger,
		destination,
		{ ...runData },
		pinData,
		new Set(),
		new Set(),
	);
}
