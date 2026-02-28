import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type WaitUnit = 'seconds' | 'minutes' | 'hours' | 'days';

const UNIT_TO_MS: Record<WaitUnit, number> = {
	seconds: 1_000,
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

function isValidUnit(value: string): value is WaitUnit {
	return value in UNIT_TO_MS;
}

export class Wait implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wait',
		name: 'n0n-nodes.wait',
		group: ['organization'],
		version: 1,
		description: 'Wait before continuing execution',
		defaults: {
			name: 'Wait',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: 'onReceived',
				path: '={{$parameter["path"]}}',
				restartWebhook: true,
			},
		],
		properties: [
			{
				displayName: 'Resume',
				name: 'resume',
				type: 'options',
				options: [
					{
						name: 'After Time Interval',
						value: 'afterTimeInterval',
						description: 'Waits for a certain amount of time',
					},
					{
						name: 'At Specified Time',
						value: 'atSpecifiedTime',
						description: 'Waits until a specific date and time',
					},
					{
						name: 'On Webhook Call',
						value: 'onWebhook',
						description: 'Waits for a webhook call before continuing',
					},
				],
				default: 'afterTimeInterval',
				description: 'How the workflow should resume',
			},

			// Time interval fields
			{
				displayName: 'Wait Amount',
				name: 'amount',
				type: 'number',
				typeOptions: {
					minValue: 0,
					numberPrecision: 2,
				},
				default: 1,
				description: 'How long to wait',
				displayOptions: {
					show: {
						resume: ['afterTimeInterval'],
					},
				},
			},
			{
				displayName: 'Wait Unit',
				name: 'unit',
				type: 'options',
				options: [
					{ name: 'Seconds', value: 'seconds' },
					{ name: 'Minutes', value: 'minutes' },
					{ name: 'Hours', value: 'hours' },
					{ name: 'Days', value: 'days' },
				],
				default: 'seconds',
				description: 'Time unit for the wait amount',
				displayOptions: {
					show: {
						resume: ['afterTimeInterval'],
					},
				},
			},

			// Specific time field
			{
				displayName: 'Date and Time',
				name: 'dateTime',
				type: 'dateTime',
				default: '',
				description: 'The date and time to wait for before continuing',
				required: true,
				displayOptions: {
					show: {
						resume: ['atSpecifiedTime'],
					},
				},
			},

			// Webhook fields
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{ name: 'GET', value: 'GET' },
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'DELETE', value: 'DELETE' },
				],
				default: 'GET',
				description: 'The HTTP method for the webhook',
				displayOptions: {
					show: {
						resume: ['onWebhook'],
					},
				},
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'webhook',
				description: 'The webhook path to listen on',
				displayOptions: {
					show: {
						resume: ['onWebhook'],
					},
				},
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'On Received',
						value: 'onReceived',
						description: 'Returns immediately with 200 status',
					},
					{
						name: 'Last Node',
						value: 'lastNode',
						description: 'Returns data from last node executed',
					},
					{
						name: 'Response Node',
						value: 'responseNode',
						description: 'Response from Respond to Webhook node',
					},
				],
				default: 'onReceived',
				description: 'When and how to respond to the webhook',
				displayOptions: {
					show: {
						resume: ['onWebhook'],
					},
				},
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const resp = this.getResponseObject();

		resp.status(200).end();

		return {
			workflowData: [[{ json: (req.body ?? {}) as IDataObject }]],
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const resume = this.getNodeParameter('resume', 0) as string;

		if (resume === 'onWebhook') {
			// Webhook mode: put execution to wait indefinitely until webhook is received
			const WAIT_INDEFINITELY = new Date('2099-12-31T23:59:59.999Z');
			await this.putExecutionToWait(WAIT_INDEFINITELY);
			return [this.getInputData()];
		}

		let waitTill: Date;

		if (resume === 'afterTimeInterval') {
			const unit = this.getNodeParameter('unit', 0) as string;

			if (!isValidUnit(unit)) {
				throw new NodeOperationError(
					this.getNode(),
					`Invalid wait unit "${unit}". Valid units are: seconds, minutes, hours, days.`,
				);
			}

			const amount = this.getNodeParameter('amount', 0) as number;
			if (amount < 0) {
				throw new NodeOperationError(
					this.getNode(),
					'Wait amount must be a non-negative number.',
				);
			}

			const waitMs = amount * UNIT_TO_MS[unit];
			waitTill = new Date(Date.now() + waitMs);
		} else {
			// atSpecifiedTime
			const dateTimeStr = this.getNodeParameter('dateTime', 0) as string;
			waitTill = new Date(dateTimeStr);

			if (Number.isNaN(waitTill.getTime())) {
				throw new NodeOperationError(
					this.getNode(),
					'Invalid date format. Please provide a valid date and time.',
				);
			}
		}

		const waitMs = Math.max(waitTill.getTime() - Date.now(), 0);

		// For short waits (< 65s), keep execution active in memory
		// because the DB-based resume only polls every 60s
		if (waitMs < 65_000) {
			return new Promise((resolve) => {
				const timer = setTimeout(() => resolve([this.getInputData()]), waitMs);
				this.onExecutionCancellation(() => {
					clearTimeout(timer);
					resolve([this.getInputData()]);
				});
			});
		}

		// Longer waits: persist to DB and let engine resume
		await this.putExecutionToWait(waitTill);
		return [this.getInputData()];
	}
}
