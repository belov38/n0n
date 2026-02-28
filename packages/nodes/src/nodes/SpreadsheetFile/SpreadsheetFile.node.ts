import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

function parseCsv(
	csvString: string,
	delimiter: string,
	hasHeaderRow: boolean,
): IDataObject[] {
	const lines = csvString.split(/\r?\n/).filter((line) => line.trim() !== '');
	if (lines.length === 0) return [];

	const parseRow = (row: string): string[] => {
		const result: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let j = 0; j < row.length; j++) {
			const char = row[j];

			if (inQuotes) {
				if (char === '"') {
					if (j + 1 < row.length && row[j + 1] === '"') {
						current += '"';
						j++;
					} else {
						inQuotes = false;
					}
				} else {
					current += char;
				}
			} else {
				if (char === '"') {
					inQuotes = true;
				} else if (char === delimiter) {
					result.push(current);
					current = '';
				} else {
					current += char;
				}
			}
		}
		result.push(current);
		return result;
	};

	if (hasHeaderRow) {
		const headers = parseRow(lines[0]);
		return lines.slice(1).map((line) => {
			const values = parseRow(line);
			const obj: IDataObject = {};
			for (let h = 0; h < headers.length; h++) {
				obj[headers[h]] = values[h] ?? '';
			}
			return obj;
		});
	}

	return lines.map((line) => {
		const values = parseRow(line);
		const obj: IDataObject = {};
		for (let v = 0; v < values.length; v++) {
			obj[`column_${v}`] = values[v];
		}
		return obj;
	});
}

function itemsToCsv(
	items: IDataObject[],
	delimiter: string,
	includeHeader: boolean,
): string {
	if (items.length === 0) return '';

	const headers = Object.keys(items[0]);
	const lines: string[] = [];

	if (includeHeader) {
		lines.push(headers.map((h) => escapeCsvValue(h, delimiter)).join(delimiter));
	}

	for (const item of items) {
		const row = headers.map((h) => {
			const value = item[h];
			return escapeCsvValue(value == null ? '' : String(value), delimiter);
		});
		lines.push(row.join(delimiter));
	}

	return lines.join('\n');
}

function escapeCsvValue(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

export class SpreadsheetFile implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Spreadsheet File',
		name: 'n0n-nodes.spreadsheetFile',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}} CSV',
		description: 'Read and write CSV spreadsheet files',
		defaults: {
			name: 'Spreadsheet File',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{
						name: 'Read',
						value: 'read',
						description: 'Read CSV data from input',
						action: 'Read CSV data',
					},
					{
						name: 'Write',
						value: 'write',
						description: 'Write items to CSV',
						action: 'Write items to CSV',
					},
				],
				default: 'read',
				noDataExpression: true,
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						operation: ['read'],
					},
				},
				description: 'Name of the binary property containing the CSV file',
			},
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						operation: ['write'],
					},
				},
				description: 'Name of the binary property to write the CSV file to',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Header Row',
						name: 'headerRow',
						type: 'boolean',
						default: true,
						description: 'Whether the first row contains column headers',
					},
					{
						displayName: 'Delimiter',
						name: 'delimiter',
						type: 'string',
						default: ',',
						description: 'The delimiter to use',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;
		const delimiter = (options.delimiter as string) ?? ',';
		const headerRow = (options.headerRow as boolean) ?? true;

		if (operation === 'read') {
			const returnData: INodeExecutionData[] = [];

			for (let i = 0; i < items.length; i++) {
				try {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
					const csvString = Buffer.from(binaryData.data, 'base64').toString('utf-8');
					const rows = parseCsv(csvString, delimiter, headerRow);

					for (const row of rows) {
						returnData.push({ json: row });
					}
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: i },
						});
						continue;
					}
					throw error;
				}
			}

			return [returnData];
		}

		if (operation === 'write') {
			const jsonItems = items.map((item) => item.json);
			const csvOutput = itemsToCsv(jsonItems, delimiter, headerRow);
			const binaryPropertyName = this.getNodeParameter('outputBinaryPropertyName', 0) as string;

			const binaryData = await this.helpers.prepareBinaryData(
				Buffer.from(csvOutput, 'utf-8'),
				'spreadsheet.csv',
				'text/csv',
			);

			return [
				[
					{
						json: {},
						binary: {
							[binaryPropertyName]: binaryData,
						},
					},
				],
			];
		}

		throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
	}
}
