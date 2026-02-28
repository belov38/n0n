import type {
	IExecuteData,
	INode,
	INodeExecutionData,
	IPinData,
	IRunData,
	ITaskDataConnectionsSource,
	IWaitingForExecution,
	IWaitingForExecutionSource,
	NodeConnectionType,
	ISourceData,
} from 'n8n-workflow';

import type { DirectedGraph } from './directed-graph';
import { getIncomingDataFromAnyRun } from './get-incoming-data';

function addWaitingExecution(
	waitingExecution: IWaitingForExecution,
	nodeName: string,
	runIndex: number,
	inputType: NodeConnectionType,
	inputIndex: number,
	executionData: INodeExecutionData[] | null,
): void {
	const nodeObj = waitingExecution[nodeName] ?? {};
	const taskConns = nodeObj[runIndex] ?? {};
	const list = taskConns[inputType] ?? [];

	list[inputIndex] = executionData;

	taskConns[inputType] = list;
	nodeObj[runIndex] = taskConns;
	waitingExecution[nodeName] = nodeObj;
}

function addWaitingExecutionSource(
	waitingExecutionSource: IWaitingForExecutionSource,
	nodeName: string,
	runIndex: number,
	inputType: NodeConnectionType,
	inputIndex: number,
	sourceData: ISourceData | null,
): void {
	const nodeObj = waitingExecutionSource[nodeName] ?? {};
	const taskConns = nodeObj[runIndex] ?? {};
	const list = taskConns[inputType] ?? [];

	list[inputIndex] = sourceData;

	taskConns[inputType] = list;
	nodeObj[runIndex] = taskConns;
	waitingExecutionSource[nodeName] = nodeObj;
}

/**
 * Rebuild the execution stack from a directed graph, start nodes, and
 * existing run/pin data. This enables restarting an execution midway.
 *
 * For each start node:
 * - If it has no incoming connections: push it with empty `{ json: {} }` data
 * - If incoming connections all have data: push onto nodeExecutionStack
 * - Otherwise: put into waitingExecution
 */
export function recreateNodeExecutionStack(
	graph: DirectedGraph,
	startNodes: Set<INode>,
	runData: IRunData,
	pinData: IPinData,
): {
	nodeExecutionStack: IExecuteData[];
	waitingExecution: IWaitingForExecution;
	waitingExecutionSource: IWaitingForExecutionSource;
} {
	const nodeExecutionStack: IExecuteData[] = [];
	const waitingExecution: IWaitingForExecution = {};
	const waitingExecutionSource: IWaitingForExecutionSource = {};

	for (const startNode of startNodes) {
		const incomingConns = graph
			.getDirectParentConnections(startNode)
			.filter((c) => c.type === ('main' as NodeConnectionType));

		if (incomingConns.length === 0) {
			// Trigger node or root — push with empty data
			nodeExecutionStack.push({
				node: startNode,
				data: { main: [[{ json: {} }]] },
				source: null,
			});
			continue;
		}

		// Check if all incoming connections have data
		let allHaveData = true;
		const incomingData: INodeExecutionData[][] = [];
		const sourceInfo: ITaskDataConnectionsSource = { main: [] };

		for (const conn of incomingConns) {
			const sourceNode = conn.from;

			if (pinData[sourceNode.name]) {
				incomingData.push(pinData[sourceNode.name]);
				sourceInfo.main.push({
					previousNode: sourceNode.name,
					previousNodeOutput: conn.outputIndex,
					previousNodeRun: 0,
				});
			} else {
				const nodeData = getIncomingDataFromAnyRun(
					runData,
					sourceNode.name,
					conn.type,
					conn.outputIndex,
				);

				if (nodeData) {
					incomingData.push(nodeData.data);
					sourceInfo.main.push({
						previousNode: sourceNode.name,
						previousNodeOutput: conn.outputIndex,
						previousNodeRun: nodeData.runIndex,
					});
				} else {
					allHaveData = false;
				}
			}
		}

		if (allHaveData) {
			nodeExecutionStack.push({
				node: startNode,
				data: { main: incomingData },
				source: sourceInfo,
			});
		} else {
			// Partially available data — put into waiting
			const nodeName = startNode.name;
			const nextRunIndex = waitingExecution[nodeName]
				? Object.keys(waitingExecution[nodeName]).length
				: 0;

			for (const conn of incomingConns) {
				const nodeData = getIncomingDataFromAnyRun(
					runData,
					conn.from.name,
					conn.type,
					conn.outputIndex,
				);

				if (nodeData) {
					addWaitingExecution(
						waitingExecution,
						nodeName,
						nextRunIndex,
						conn.type,
						conn.inputIndex,
						nodeData.data,
					);

					addWaitingExecutionSource(
						waitingExecutionSource,
						nodeName,
						nextRunIndex,
						conn.type,
						conn.inputIndex,
						{
							previousNode: conn.from.name,
							previousNodeRun: nextRunIndex,
							previousNodeOutput: conn.outputIndex,
						},
					);
				}
			}
		}
	}

	return { nodeExecutionStack, waitingExecution, waitingExecutionSource };
}
