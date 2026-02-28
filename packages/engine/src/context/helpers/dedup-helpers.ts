import type { IDataObject } from 'n8n-workflow';

export interface ProcessedDataService {
	getProcessedData(workflowId: string, context: string): Promise<Set<string>>;
	saveProcessedData(
		workflowId: string,
		context: string,
		data: Set<string>,
	): Promise<void>;
}

/** Filter items that have already been processed and record new ones. */
export async function checkProcessedAndRecord(
	service: ProcessedDataService,
	workflowId: string,
	nodeName: string,
	items: IDataObject[],
	propertyName: string,
	mode: 'onlyNew' | 'all' = 'onlyNew',
): Promise<IDataObject[]> {
	const context = `${nodeName}:${propertyName}`;
	const processed = await service.getProcessedData(workflowId, context);

	const newItems: IDataObject[] = [];
	const newProcessed = new Set(processed);

	for (const item of items) {
		const value = String(item[propertyName] ?? '');
		if (!processed.has(value)) {
			newItems.push(item);
			newProcessed.add(value);
		}
	}

	await service.saveProcessedData(workflowId, context, newProcessed);

	return mode === 'onlyNew' ? newItems : items;
}
