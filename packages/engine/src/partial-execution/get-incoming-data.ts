import type { INodeExecutionData, IRunData, NodeConnectionType } from 'n8n-workflow';

/**
 * Get execution data for a specific node output at a specific run index.
 */
export function getIncomingData(
	runData: IRunData,
	nodeName: string,
	runIndex: number,
	connectionType: NodeConnectionType,
	outputIndex: number,
): INodeExecutionData[] | null {
	return runData[nodeName]?.at(runIndex)?.data?.[connectionType]?.at(outputIndex) ?? null;
}

/**
 * Get execution data for a specific node output from the first run that has data.
 */
export function getIncomingDataFromAnyRun(
	runData: IRunData,
	nodeName: string,
	connectionType: NodeConnectionType,
	outputIndex: number,
): { data: INodeExecutionData[]; runIndex: number } | undefined {
	const runs = runData[nodeName]?.length ?? 0;

	for (let runIndex = 0; runIndex < runs; runIndex++) {
		const data = getIncomingData(runData, nodeName, runIndex, connectionType, outputIndex);
		if (data && data.length > 0) {
			return { data, runIndex };
		}
	}

	return undefined;
}
