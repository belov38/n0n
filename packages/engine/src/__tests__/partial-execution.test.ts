import { describe, test, expect } from 'bun:test';
import type { INode, IRunData, IPinData, IDataObject, NodeConnectionType } from 'n8n-workflow';

import { DirectedGraph } from '../partial-execution/directed-graph';
import { findSubgraph } from '../partial-execution/find-subgraph';
import { findStartNodes, isDirty } from '../partial-execution/find-start-nodes';
import { cleanRunData } from '../partial-execution/clean-run-data';
import { detectCycles } from '../partial-execution/handle-cycles';
import { handleCycles } from '../partial-execution/handle-cycles';
import { getIncomingData, getIncomingDataFromAnyRun } from '../partial-execution/get-incoming-data';

const MAIN = 'main' as NodeConnectionType;

function createNode(name: string, overrides: Partial<INode> = {}): INode {
	return {
		name,
		parameters: {},
		type: 'n8n-nodes-base.set',
		typeVersion: 1,
		id: `id-${name}`,
		position: [0, 0],
		disabled: false,
		...overrides,
	};
}

function createRunData(
	nodeName: string,
	data: IDataObject = { value: 1 },
): IRunData {
	return {
		[nodeName]: [
			{
				startTime: 0,
				executionTime: 0,
				executionStatus: 'success',
				executionIndex: 0,
				source: [],
				data: {
					main: [[{ json: data }]],
				},
			},
		],
	};
}

// ---------------------------------------------------------------------------
// DirectedGraph
// ---------------------------------------------------------------------------

describe('DirectedGraph', () => {
	describe('fromNodesAndConnections', () => {
		test('creates graph with correct nodes and edges', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = DirectedGraph.fromNodesAndConnections(
				[node1, node2, node3],
				{
					Node1: {
						main: [[{ node: 'Node2', type: MAIN, index: 0 }]],
					},
					Node2: {
						main: [[{ node: 'Node3', type: MAIN, index: 0 }]],
					},
				},
			);

			expect(graph.hasNode('Node1')).toBe(true);
			expect(graph.hasNode('Node2')).toBe(true);
			expect(graph.hasNode('Node3')).toBe(true);
			expect(graph.hasNode('Node4')).toBe(false);

			expect(graph.getConnections().length).toBe(2);
		});

		test('handles multiple outputs and inputs', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = DirectedGraph.fromNodesAndConnections(
				[node1, node2, node3],
				{
					Node1: {
						main: [
							[{ node: 'Node2', type: MAIN, index: 0 }],
							[{ node: 'Node3', type: MAIN, index: 0 }],
						],
					},
				},
			);

			const outgoing = graph.getDirectChildConnections(node1);
			expect(outgoing.length).toBe(2);
			expect(outgoing.find((c) => c.to === node2)?.outputIndex).toBe(0);
			expect(outgoing.find((c) => c.to === node3)?.outputIndex).toBe(1);
		});
	});

	describe('getDirectParentConnections / getDirectChildConnections', () => {
		test('returns correct parent and child connections', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
				);

			const parents = graph.getDirectParentConnections(node2);
			expect(parents.length).toBe(1);
			expect(parents[0].from).toBe(node1);

			const children = graph.getDirectChildConnections(node2);
			expect(children.length).toBe(1);
			expect(children[0].to).toBe(node3);
		});

		test('node with no parents returns empty array', () => {
			const node1 = createNode('Node1');
			const graph = new DirectedGraph().addNodes(node1);

			expect(graph.getDirectParentConnections(node1)).toEqual([]);
		});

		test('node with no children returns empty array', () => {
			const node1 = createNode('Node1');
			const graph = new DirectedGraph().addNodes(node1);

			expect(graph.getDirectChildConnections(node1)).toEqual([]);
		});
	});

	describe('getChildren', () => {
		test('returns all transitive children', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
				);

			const children = graph.getChildren(node1);
			expect(children.size).toBe(2);
			expect(children).toContain(node2);
			expect(children).toContain(node3);
		});

		//     +------+    +------+    +------+
		//  +->|node1 |--->|node2 |--->|node3 |--+
		//  |  +------+    +------+    +------+  |
		//  +------------------------------------+
		test('terminates when finding a cycle', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
					{ from: node3, to: node1 },
				);

			const children = graph.getChildren(node1);
			expect(children.size).toBe(3);
			expect(children).toContain(node1);
			expect(children).toContain(node2);
			expect(children).toContain(node3);
		});
	});

	describe('getStronglyConnectedComponents', () => {
		// +------+    +------+    +------+
		// |node1 |--->|node2 |--->|node4 |
		// +------+    +--+---+    +------+
		//    ^           |
		//    |           v
		// +--+---+
		// |node3 |
		// +------+
		test('finds strongly connected components', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');
			const node4 = createNode('Node4');

			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3, node4)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
					{ from: node3, to: node1 },
					{ from: node2, to: node4 },
				);

			const sccs = graph.getStronglyConnectedComponents();
			expect(sccs.length).toBe(2);
			expect(sccs).toContainEqual(new Set([node4]));
			expect(sccs).toContainEqual(new Set([node1, node2, node3]));
		});
	});

	describe('toIConnections', () => {
		test('exports back to IConnections format', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');

			const graph = new DirectedGraph()
				.addNodes(node1, node2)
				.addConnections({ from: node1, to: node2 });

			const conns = graph.toIConnections();
			expect(conns.Node1).toBeDefined();
			const firstConn = conns.Node1?.[MAIN]?.[0]?.[0];
			expect(firstConn).toEqual({
				node: 'Node2',
				type: MAIN,
				index: 0,
			});
		});
	});

	describe('depthFirstSearch', () => {
		test('finds node using predicate', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');
			const node3 = createNode('Node3');

			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
				);

			const found = graph.depthFirstSearch({
				from: node1,
				fn: (n) => n === node3,
			});
			expect(found).toBe(node3);
		});

		test('returns undefined when not found', () => {
			const node1 = createNode('Node1');
			const node2 = createNode('Node2');

			const graph = new DirectedGraph()
				.addNodes(node1, node2)
				.addConnections({ from: node1, to: node2 });

			const found = graph.depthFirstSearch({
				from: node1,
				fn: () => false,
			});
			expect(found).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// findSubgraph
// ---------------------------------------------------------------------------

describe('findSubgraph', () => {
	// trigger -> node1 -> node2 -> destination
	//                  \-> node3
	test('returns only nodes on path between trigger and destination', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');
		const destination = createNode('Destination');

		const graph = new DirectedGraph()
			.addNodes(trigger, node1, node2, node3, destination)
			.addConnections(
				{ from: trigger, to: node1 },
				{ from: node1, to: node2 },
				{ from: node1, to: node3 },
				{ from: node2, to: destination },
			);

		const subgraph = findSubgraph({ graph, destination, trigger });

		expect(subgraph.hasNode('Trigger')).toBe(true);
		expect(subgraph.hasNode('Node1')).toBe(true);
		expect(subgraph.hasNode('Node2')).toBe(true);
		expect(subgraph.hasNode('Destination')).toBe(true);
		// Node3 is on a different branch, not on path to destination
		expect(subgraph.hasNode('Node3')).toBe(false);
	});

	// trigger -> destination (direct)
	test('works for single-edge path', () => {
		const trigger = createNode('Trigger');
		const destination = createNode('Destination');

		const graph = new DirectedGraph()
			.addNodes(trigger, destination)
			.addConnections({ from: trigger, to: destination });

		const subgraph = findSubgraph({ graph, destination, trigger });

		expect(subgraph.hasNode('Trigger')).toBe(true);
		expect(subgraph.hasNode('Destination')).toBe(true);
		expect(subgraph.getConnections().length).toBe(1);
	});

	// trigger -> node1 -> node2 -> node3
	//            ^                  |
	//            +------------------+
	test('handles cycles in the graph', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');

		const graph = new DirectedGraph()
			.addNodes(trigger, node1, node2, node3)
			.addConnections(
				{ from: trigger, to: node1 },
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
				{ from: node3, to: node1 },
			);

		const subgraph = findSubgraph({ graph, destination: node3, trigger });

		expect(subgraph.hasNode('Trigger')).toBe(true);
		expect(subgraph.hasNode('Node1')).toBe(true);
		expect(subgraph.hasNode('Node2')).toBe(true);
		expect(subgraph.hasNode('Node3')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findStartNodes
// ---------------------------------------------------------------------------

describe('findStartNodes', () => {
	test('trigger with no run data is itself a start node', () => {
		const trigger = createNode('Trigger');
		const destination = createNode('Destination');

		const graph = new DirectedGraph()
			.addNodes(trigger, destination)
			.addConnections({ from: trigger, to: destination });

		const starts = findStartNodes({
			graph,
			trigger,
			destination,
			runData: {},
			pinData: {},
		});

		expect(starts.size).toBe(1);
		expect(starts).toContain(trigger);
	});

	// trigger(has data) -> node1(has data) -> destination(target)
	test('destination is a start node when all parents have data', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');
		const destination = createNode('Destination');

		const graph = new DirectedGraph()
			.addNodes(trigger, node1, destination)
			.addConnections(
				{ from: trigger, to: node1 },
				{ from: node1, to: destination },
			);

		const runData: IRunData = {
			...createRunData('Trigger'),
			...createRunData('Node1'),
		};

		const starts = findStartNodes({
			graph,
			trigger,
			destination,
			runData,
			pinData: {},
		});

		expect(starts.size).toBe(1);
		expect(starts).toContain(destination);
	});

	// trigger(has data) -> node1(dirty) -> destination
	test('dirty node is a start node', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');
		const destination = createNode('Destination');

		const graph = new DirectedGraph()
			.addNodes(trigger, node1, destination)
			.addConnections(
				{ from: trigger, to: node1 },
				{ from: node1, to: destination },
			);

		const starts = findStartNodes({
			graph,
			trigger,
			destination,
			runData: createRunData('Trigger'),
			pinData: {},
		});

		expect(starts.size).toBe(1);
		expect(starts).toContain(node1);
	});

	test('pinned data makes a node not dirty', () => {
		const node = createNode('Node1');
		const pinData: IPinData = {
			Node1: [{ json: { pinned: true } }],
		};

		expect(isDirty(node, {}, pinData)).toBe(false);
	});

	test('node with run data is not dirty', () => {
		const node = createNode('Node1');
		const runData = createRunData('Node1');

		expect(isDirty(node, runData, {})).toBe(false);
	});

	test('node with no data is dirty', () => {
		const node = createNode('Node1');
		expect(isDirty(node, {}, {})).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// cleanRunData
// ---------------------------------------------------------------------------

describe('cleanRunData', () => {
	test('removes run data for specified nodes and their children', () => {
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');

		const graph = new DirectedGraph()
			.addNodes(node1, node2, node3)
			.addConnections(
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
			);

		const runData: IRunData = {
			...createRunData('Node1'),
			...createRunData('Node2'),
			...createRunData('Node3'),
		};

		const cleaned = cleanRunData(runData, graph, new Set([node2]));

		expect(cleaned.Node1).toBeDefined();
		expect(cleaned.Node2).toBeUndefined();
		expect(cleaned.Node3).toBeUndefined();
	});

	test('removes run data for nodes not in graph', () => {
		const node1 = createNode('Node1');
		const graph = new DirectedGraph().addNodes(node1);

		const runData: IRunData = {
			...createRunData('Node1'),
			...createRunData('Orphan'),
		};

		const cleaned = cleanRunData(runData, graph, new Set());
		expect(cleaned.Node1).toBeDefined();
		expect(cleaned.Orphan).toBeUndefined();
	});

	test('does not mutate original run data', () => {
		const node1 = createNode('Node1');
		const graph = new DirectedGraph().addNodes(node1);

		const runData: IRunData = { ...createRunData('Node1') };
		const original = { ...runData };

		cleanRunData(runData, graph, new Set([node1]));
		expect(runData).toEqual(original);
	});
});

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------

describe('detectCycles', () => {
	test('returns empty array for acyclic graph', () => {
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');

		const graph = new DirectedGraph()
			.addNodes(node1, node2, node3)
			.addConnections(
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
			);

		expect(detectCycles(graph)).toEqual([]);
	});

	//  +------+    +------+    +------+
	//  |node1 |--->|node2 |--->|node3 |---+
	//  +------+    +------+    +------+   |
	//     ^                               |
	//     +-------------------------------+
	test('detects a single cycle', () => {
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');

		const graph = new DirectedGraph()
			.addNodes(node1, node2, node3)
			.addConnections(
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
				{ from: node3, to: node1 },
			);

		const cycles = detectCycles(graph);
		expect(cycles.length).toBe(1);
		expect(cycles[0].sort()).toEqual(['Node1', 'Node2', 'Node3']);
	});

	test('detects self-loop', () => {
		const node1 = createNode('Node1');
		const graph = new DirectedGraph()
			.addNodes(node1)
			.addConnections({ from: node1, to: node1 });

		const cycles = detectCycles(graph);
		expect(cycles.length).toBe(1);
		expect(cycles[0]).toEqual(['Node1']);
	});
});

// ---------------------------------------------------------------------------
// handleCycles
// ---------------------------------------------------------------------------

describe('handleCycles', () => {
	test('replaces start node with cycle entry point', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');
		const node2 = createNode('Node2');
		const node3 = createNode('Node3');

		// trigger -> node1 -> node2 -> node3 -> node1 (cycle)
		const graph = new DirectedGraph()
			.addNodes(trigger, node1, node2, node3)
			.addConnections(
				{ from: trigger, to: node1 },
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
				{ from: node3, to: node1 },
			);

		// node3 is a start node that is part of the cycle
		const startNodes = new Set([node3]);
		const result = handleCycles(graph, startNodes, trigger);

		// Should be replaced with node1 (first cycle node reachable from trigger)
		expect(result.size).toBe(1);
		expect(result).toContain(node1);
		expect(result.has(node3)).toBe(false);
	});

	test('does nothing when no cycles', () => {
		const trigger = createNode('Trigger');
		const node1 = createNode('Node1');

		const graph = new DirectedGraph()
			.addNodes(trigger, node1)
			.addConnections({ from: trigger, to: node1 });

		const startNodes = new Set([node1]);
		const result = handleCycles(graph, startNodes, trigger);

		expect(result.size).toBe(1);
		expect(result).toContain(node1);
	});
});

// ---------------------------------------------------------------------------
// getIncomingData / getIncomingDataFromAnyRun
// ---------------------------------------------------------------------------

describe('getIncomingData', () => {
	test('returns data for existing node run', () => {
		const runData = createRunData('Node1', { value: 42 });
		const result = getIncomingData(runData, 'Node1', 0, MAIN, 0);

		expect(result).not.toBeNull();
		expect(result![0].json).toEqual({ value: 42 });
	});

	test('returns null for missing node', () => {
		const result = getIncomingData({}, 'Missing', 0, MAIN, 0);
		expect(result).toBeNull();
	});
});

describe('getIncomingDataFromAnyRun', () => {
	test('returns data from first run with output', () => {
		const runData = createRunData('Node1', { value: 42 });
		const result = getIncomingDataFromAnyRun(runData, 'Node1', MAIN, 0);

		expect(result).toBeDefined();
		expect(result!.runIndex).toBe(0);
		expect(result!.data[0].json).toEqual({ value: 42 });
	});

	test('returns undefined for missing node', () => {
		const result = getIncomingDataFromAnyRun({}, 'Missing', MAIN, 0);
		expect(result).toBeUndefined();
	});
});
