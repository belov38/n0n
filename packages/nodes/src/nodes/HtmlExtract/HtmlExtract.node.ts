import * as cheerio from 'cheerio';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface ExtractionValue {
	key: string;
	cssSelector: string;
	returnValue: 'text' | 'html' | 'attribute';
	attribute?: string;
}

export class HtmlExtract implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTML Extract',
		name: 'n0n-nodes.htmlExtract',
		group: ['transform'],
		version: 1,
		subtitle: 'Extract data from HTML',
		description: 'Extract data from HTML using CSS selectors',
		defaults: {
			name: 'HTML Extract',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Source Data',
				name: 'sourceData',
				type: 'options',
				options: [
					{
						name: 'JSON Property',
						value: 'json',
						description: 'Use a property from the input JSON',
					},
					{
						name: 'Binary Property',
						value: 'binary',
						description: 'Use a binary property containing HTML',
					},
				],
				default: 'json',
				noDataExpression: true,
			},
			{
				displayName: 'Property Name',
				name: 'dataPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the property containing the HTML',
			},
			{
				displayName: 'Extraction Values',
				name: 'extractionValues',
				placeholder: 'Add Value',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						name: 'values',
						displayName: 'Values',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								description: 'The key under which the extracted value should be saved',
							},
							{
								displayName: 'CSS Selector',
								name: 'cssSelector',
								type: 'string',
								default: '',
								placeholder: '.price',
								description: 'The CSS selector to use',
							},
							{
								displayName: 'Return Value',
								name: 'returnValue',
								type: 'options',
								options: [
									{
										name: 'Attribute',
										value: 'attribute',
										description: 'Get an attribute value from an element',
									},
									{
										name: 'HTML',
										value: 'html',
										description: 'Get the inner HTML of the element',
									},
									{
										name: 'Text',
										value: 'text',
										description: 'Get the text content of the element',
									},
								],
								default: 'text',
							},
							{
								displayName: 'Attribute',
								name: 'attribute',
								type: 'string',
								displayOptions: {
									show: {
										returnValue: ['attribute'],
									},
								},
								default: '',
								placeholder: 'class',
								description: 'The name of the attribute to return',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Trim Values',
						name: 'trimValues',
						type: 'boolean',
						default: true,
						description: 'Whether to trim whitespace from extracted values',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const sourceData = this.getNodeParameter('sourceData', i) as string;
				const dataPropertyName = this.getNodeParameter('dataPropertyName', i) as string;
				const extractionValues = this.getNodeParameter('extractionValues', i) as {
					values?: ExtractionValue[];
				};
				const options = this.getNodeParameter('options', i, {}) as IDataObject;

				let htmlContent: string;

				if (sourceData === 'json') {
					const rawValue = items[i].json[dataPropertyName];
					if (rawValue === undefined) {
						throw new NodeOperationError(
							this.getNode(),
							`Item has no JSON property called "${dataPropertyName}"`,
							{ itemIndex: i },
						);
					}
					htmlContent = String(rawValue);
				} else {
					const binaryData = this.helpers.assertBinaryData(i, dataPropertyName);
					htmlContent = Buffer.from(binaryData.data, 'base64').toString('utf-8');
				}

				const $ = cheerio.load(htmlContent);
				const extractedData: IDataObject = {};

				if (extractionValues.values) {
					for (const valueData of extractionValues.values) {
						const { key, cssSelector, returnValue, attribute } = valueData;

						const elements = $(cssSelector);
						const values: string[] = [];

						elements.each((_index, element) => {
							let extractedValue: string | undefined;

							if (returnValue === 'text') {
								extractedValue = $(element).text();
							} else if (returnValue === 'html') {
								extractedValue = $(element).html() ?? undefined;
							} else if (returnValue === 'attribute' && attribute) {
								extractedValue = $(element).attr(attribute);
							}

							if (extractedValue !== undefined) {
								if (options.trimValues !== false) {
									extractedValue = extractedValue.trim();
								}
								values.push(extractedValue);
							}
						});

						extractedData[key] = values.length === 1 ? values[0] : values;
					}
				}

				returnData.push({
					json: extractedData,
					pairedItem: { item: i },
				});
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
