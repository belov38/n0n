import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, deepCopy } from 'n8n-workflow';

export class Xml implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'XML',
		name: 'n0n-nodes.xml',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["mode"]==="jsonToXml" ? "JSON to XML" : "XML to JSON"}}',
		description: 'Convert data between JSON and XML',
		defaults: {
			name: 'XML',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'XML to JSON',
						value: 'xmlToJson',
						description: 'Converts data from XML to JSON',
					},
					{
						name: 'JSON to XML',
						value: 'jsonToXml',
						description: 'Converts data from JSON to XML',
					},
				],
				default: 'xmlToJson',
				noDataExpression: true,
			},
			{
				displayName: 'Property Name',
				name: 'dataPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the property containing the data to convert',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Headless',
						name: 'headless',
						type: 'boolean',
						default: false,
						description: 'Whether to omit the XML declaration header',
					},
					{
						displayName: 'Explicit Array',
						name: 'explicitArray',
						type: 'boolean',
						default: false,
						description: 'Whether to always wrap child nodes in an array',
					},
					{
						displayName: 'Ignore Attributes',
						name: 'ignoreAttributes',
						type: 'boolean',
						default: false,
						description: 'Whether to ignore XML attributes',
					},
					{
						displayName: 'Trim Values',
						name: 'trimValues',
						type: 'boolean',
						default: true,
						description: 'Whether to trim whitespace from text values',
					},
					{
						displayName: 'Root Name',
						name: 'rootName',
						type: 'string',
						default: 'root',
						description: 'Root element name for JSON to XML conversion',
						displayOptions: {
							show: {
								'/mode': ['jsonToXml'],
							},
						},
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const mode = this.getNodeParameter('mode', 0) as string;
		const dataPropertyName = this.getNodeParameter('dataPropertyName', 0) as string;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;

		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				if (mode === 'xmlToJson') {
					const xmlData = items[i].json[dataPropertyName];
					if (xmlData === undefined) {
						throw new NodeOperationError(
							this.getNode(),
							`Item has no JSON property called "${dataPropertyName}"`,
							{ itemIndex: i },
						);
					}

					const parser = new XMLParser({
						ignoreAttributes: (options.ignoreAttributes as boolean) ?? false,
						isArray: options.explicitArray ? () => true : undefined,
						trimValues: (options.trimValues as boolean) ?? true,
					});

					const json = parser.parse(xmlData as string) as IDataObject;
					returnData.push({
						json: deepCopy(json),
						pairedItem: { item: i },
					});
				} else if (mode === 'jsonToXml') {
					const builder = new XMLBuilder({
						ignoreAttributes: (options.ignoreAttributes as boolean) ?? false,
						suppressBooleanAttributes: false,
						format: true,
					});

					let xmlOutput = builder.build(items[i].json) as string;

					if (!options.headless) {
						xmlOutput = `<?xml version="1.0" encoding="UTF-8"?>\n${xmlOutput}`;
					}

					returnData.push({
						json: {
							[dataPropertyName]: xmlOutput,
						},
						pairedItem: { item: i },
					});
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown mode: ${mode}`, {
						itemIndex: i,
					});
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
}
