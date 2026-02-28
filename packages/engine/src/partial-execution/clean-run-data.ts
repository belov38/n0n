import type { INode, IRunData, NodeConnectionType } from 'n8n-workflow';

import type { DirectedGraph } from './directed-graph';

/**
 * Remove run data for all nodes that will be re-executed and their children.
 * Also removes run data for sub-nodes connected via non-main connection types.
 *
 * Does not mutate the input `runData`.
 */
export function cleanRunData(
	runData: IRunData,
	graph: DirectedGraph,
	nodesToClean: Set<INode>,
): IRunData {
	const cleaned: IRunData = { ...runData };

	for (const nodeToClean of nodesToClean) {
		delete cleaned[nodeToClean.name];

		const children = graph.getChildren(nodeToClean);
		for (const child of [nodeToClean, ...children]) {
			delete cleaned[child.name];

			// Also clean sub-nodes (non-main connections, e.g. AI utility nodes)
			const parentConns = graph.getParentConnections(child);
			for (const conn of parentConns) {
				if (conn.type === ('main' as NodeConnectionType)) continue;
				delete cleaned[conn.from.name];
			}
		}
	}

	// Remove run data for nodes not in the subgraph
	for (const nodeName of Object.keys(cleaned)) {
		if (!graph.hasNode(nodeName)) {
			delete cleaned[nodeName];
		}
	}

	return cleaned;
}
