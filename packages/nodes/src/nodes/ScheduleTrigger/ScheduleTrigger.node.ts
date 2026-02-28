import type {
	CronExpression,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

interface IntervalRule {
	field: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'cronExpression';
	secondsInterval?: number;
	minutesInterval?: number;
	hoursInterval?: number;
	daysInterval?: number;
	weeksInterval?: number;
	monthsInterval?: number;
	triggerAtHour?: number;
	triggerAtMinute?: number;
	triggerAtDay?: number[];
	triggerAtDayOfMonth?: number;
	expression?: string;
}

interface ScheduleRule {
	interval: IntervalRule[];
}

function toCronExpression(interval: IntervalRule): string {
	const { field } = interval;

	switch (field) {
		case 'seconds': {
			const seconds = interval.secondsInterval ?? 30;
			return `*/${seconds} * * * * *`;
		}
		case 'minutes': {
			const minutes = interval.minutesInterval ?? 5;
			return `0 */${minutes} * * * *`;
		}
		case 'hours': {
			const hours = interval.hoursInterval ?? 1;
			const minute = interval.triggerAtMinute ?? 0;
			return `0 ${minute} */${hours} * * *`;
		}
		case 'days': {
			const days = interval.daysInterval ?? 1;
			const hour = interval.triggerAtHour ?? 0;
			const minute = interval.triggerAtMinute ?? 0;
			if (days === 1) {
				return `0 ${minute} ${hour} * * *`;
			}
			return `0 ${minute} ${hour} */${days} * *`;
		}
		case 'weeks': {
			const weekdays = interval.triggerAtDay ?? [0];
			const hour = interval.triggerAtHour ?? 0;
			const minute = interval.triggerAtMinute ?? 0;
			return `0 ${minute} ${hour} * * ${weekdays.join(',')}`;
		}
		case 'months': {
			const dayOfMonth = interval.triggerAtDayOfMonth ?? 1;
			const hour = interval.triggerAtHour ?? 0;
			const minute = interval.triggerAtMinute ?? 0;
			const months = interval.monthsInterval ?? 1;
			if (months === 1) {
				return `0 ${minute} ${hour} ${dayOfMonth} * *`;
			}
			return `0 ${minute} ${hour} ${dayOfMonth} */${months} *`;
		}
		case 'cronExpression':
			return interval.expression ?? '0 * * * * *';
		default:
			return '0 * * * * *';
	}
}

function intervalToMs(interval: IntervalRule): number {
	switch (interval.field) {
		case 'seconds':
			return (interval.secondsInterval ?? 30) * 1000;
		case 'minutes':
			return (interval.minutesInterval ?? 5) * 60 * 1000;
		case 'hours':
			return (interval.hoursInterval ?? 1) * 60 * 60 * 1000;
		case 'days':
			return (interval.daysInterval ?? 1) * 24 * 60 * 60 * 1000;
		case 'weeks':
			return (interval.weeksInterval ?? 1) * 7 * 24 * 60 * 60 * 1000;
		case 'months':
			return (interval.monthsInterval ?? 1) * 30 * 24 * 60 * 60 * 1000;
		default:
			return 60 * 1000;
	}
}

export class ScheduleTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Schedule Trigger',
		name: 'n0n-nodes.scheduleTrigger',
		group: ['trigger', 'schedule'],
		version: 1,
		description: 'Triggers the workflow on a given schedule',
		eventTriggerDescription: '',
		activationMessage:
			'Your schedule trigger will now trigger executions on the schedule you have defined.',
		defaults: {
			name: 'Schedule Trigger',
		},
		inputs: [],
		outputs: [{ type: 'main' as const }],
		properties: [
			{
				displayName: 'Trigger Rules',
				name: 'rule',
				placeholder: 'Add Rule',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {
					interval: [{ field: 'days' }],
				},
				options: [
					{
						name: 'interval',
						displayName: 'Trigger Interval',
						values: [
							{
								displayName: 'Trigger Interval',
								name: 'field',
								type: 'options',
								default: 'days',
								options: [
									{ name: 'Seconds', value: 'seconds' },
									{ name: 'Minutes', value: 'minutes' },
									{ name: 'Hours', value: 'hours' },
									{ name: 'Days', value: 'days' },
									{ name: 'Weeks', value: 'weeks' },
									{ name: 'Months', value: 'months' },
									{ name: 'Custom (Cron)', value: 'cronExpression' },
								],
							},
							{
								displayName: 'Seconds Between Triggers',
								name: 'secondsInterval',
								type: 'number',
								default: 30,
								displayOptions: { show: { field: ['seconds'] } },
								description: 'Number of seconds between each workflow trigger',
							},
							{
								displayName: 'Minutes Between Triggers',
								name: 'minutesInterval',
								type: 'number',
								default: 5,
								displayOptions: { show: { field: ['minutes'] } },
								description: 'Number of minutes between each workflow trigger',
							},
							{
								displayName: 'Hours Between Triggers',
								name: 'hoursInterval',
								type: 'number',
								default: 1,
								displayOptions: { show: { field: ['hours'] } },
								description: 'Number of hours between each workflow trigger',
							},
							{
								displayName: 'Days Between Triggers',
								name: 'daysInterval',
								type: 'number',
								default: 1,
								displayOptions: { show: { field: ['days'] } },
								description: 'Number of days between each workflow trigger',
							},
							{
								displayName: 'Weeks Between Triggers',
								name: 'weeksInterval',
								type: 'number',
								default: 1,
								displayOptions: { show: { field: ['weeks'] } },
								description: 'Would run every week unless specified otherwise',
							},
							{
								displayName: 'Months Between Triggers',
								name: 'monthsInterval',
								type: 'number',
								default: 1,
								displayOptions: { show: { field: ['months'] } },
								description: 'Would run every month unless specified otherwise',
							},
							{
								displayName: 'Trigger at Day of Month',
								name: 'triggerAtDayOfMonth',
								type: 'number',
								default: 1,
								displayOptions: { show: { field: ['months'] } },
								typeOptions: { minValue: 1, maxValue: 31 },
								description: 'The day of the month to trigger (1-31)',
							},
							{
								displayName: 'Trigger on Weekdays',
								name: 'triggerAtDay',
								type: 'multiOptions',
								default: [0],
								displayOptions: { show: { field: ['weeks'] } },
								typeOptions: { maxValue: 7 },
								options: [
									{ name: 'Monday', value: 1 },
									{ name: 'Tuesday', value: 2 },
									{ name: 'Wednesday', value: 3 },
									{ name: 'Thursday', value: 4 },
									{ name: 'Friday', value: 5 },
									{ name: 'Saturday', value: 6 },
									{ name: 'Sunday', value: 0 },
								],
							},
							{
								displayName: 'Trigger at Hour',
								name: 'triggerAtHour',
								type: 'options',
								default: 0,
								displayOptions: { show: { field: ['days', 'weeks', 'months'] } },
								options: Array.from({ length: 24 }, (_, i) => ({
									name: i === 0 ? 'Midnight' : i === 12 ? 'Noon' : `${i > 12 ? i - 12 : i}${i >= 12 ? 'pm' : 'am'}`,
									value: i,
								})),
								description: 'The hour of the day to trigger',
							},
							{
								displayName: 'Trigger at Minute',
								name: 'triggerAtMinute',
								type: 'number',
								default: 0,
								displayOptions: { show: { field: ['hours', 'days', 'weeks', 'months'] } },
								typeOptions: { minValue: 0, maxValue: 59 },
								description: 'The minute past the hour to trigger (0-59)',
							},
							{
								displayName: 'Expression',
								name: 'expression',
								type: 'string',
								default: '',
								placeholder: 'eg. 0 15 * 1 sun',
								displayOptions: { show: { field: ['cronExpression'] } },
								hint: 'Format: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]',
							},
						],
					},
				],
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const rule = this.getNodeParameter('rule', {}) as ScheduleRule;
		const intervals = rule.interval ?? [];

		if (intervals.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No schedule rules defined');
		}

		const emitTriggerData = () => {
			const now = new Date();
			const resultData: IDataObject = {
				timestamp: now.toISOString(),
				'Day of week': now.toLocaleDateString('en-US', { weekday: 'long' }),
				Year: String(now.getFullYear()),
				Month: now.toLocaleDateString('en-US', { month: 'long' }),
				'Day of month': String(now.getDate()).padStart(2, '0'),
				Hour: String(now.getHours()).padStart(2, '0'),
				Minute: String(now.getMinutes()).padStart(2, '0'),
				Second: String(now.getSeconds()).padStart(2, '0'),
			};
			this.emit([this.helpers.returnJsonArray([resultData])]);
		};

		if (this.getMode() === 'manual') {
			const manualTriggerFunction = async () => {
				emitTriggerData();
			};
			return { manualTriggerFunction };
		}

		// Production mode: register cron expressions with the runtime
		for (const interval of intervals) {
			if (interval.field === 'cronExpression' && !interval.expression) {
				throw new NodeOperationError(this.getNode(), 'Cron expression is empty');
			}

			const cronExpression = toCronExpression(interval);

			try {
				this.helpers.registerCron(
					{ expression: cronExpression as CronExpression },
					() => emitTriggerData(),
				);
			} catch {
				if (interval.field === 'cronExpression') {
					throw new NodeOperationError(this.getNode(), 'Invalid cron expression', {
						description: 'Check the format: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]',
					});
				}
				throw new NodeOperationError(this.getNode(), 'Failed to register schedule');
			}
		}

		return {};
	}
}
