import type {
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type Operation =
	| 'formatDate'
	| 'calculateDate'
	| 'getTimeBetweenDates'
	| 'extractDate'
	| 'roundDate';

type TimeUnit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds';

type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'dayOfWeek' | 'weekNumber';

type RoundUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

type RoundMode = 'roundDown' | 'roundUp';

const TIME_UNIT_TO_MS: Record<TimeUnit, number> = {
	years: 365.25 * 24 * 60 * 60 * 1000,
	months: 30.4375 * 24 * 60 * 60 * 1000,
	weeks: 7 * 24 * 60 * 60 * 1000,
	days: 24 * 60 * 60 * 1000,
	hours: 60 * 60 * 1000,
	minutes: 60 * 1000,
	seconds: 1000,
	milliseconds: 1,
};

function parseInputDate(value: string | number, itemIndex: number, node: INode): Date {
	if (typeof value === 'number') {
		// Unix timestamp: if less than 10 billion, treat as seconds
		const ts = value < 1e10 ? value * 1000 : value;
		const d = new Date(ts);
		if (isNaN(d.getTime())) {
			throw new NodeOperationError(node, `Invalid numeric date: ${value}`, {
				itemIndex,
			});
		}
		return d;
	}

	const str = String(value).trim();
	if (!str) {
		throw new NodeOperationError(node, 'Date value is empty', {
			itemIndex,
		});
	}

	// Numeric string: treat as timestamp
	if (/^\d+(\.\d+)?$/.test(str)) {
		const num = Number(str);
		const ts = num < 1e10 ? num * 1000 : num;
		const d = new Date(ts);
		if (isNaN(d.getTime())) {
			throw new NodeOperationError(node, `Invalid numeric date: ${str}`, {
				itemIndex,
			});
		}
		return d;
	}

	const d = new Date(str);
	if (isNaN(d.getTime())) {
		throw new NodeOperationError(node, `Cannot parse date: "${str}"`, {
			itemIndex,
		});
	}
	return d;
}

function addDuration(date: Date, amount: number, unit: TimeUnit): Date {
	const result = new Date(date.getTime());
	switch (unit) {
		case 'years':
			result.setFullYear(result.getFullYear() + amount);
			break;
		case 'months':
			result.setMonth(result.getMonth() + amount);
			break;
		case 'weeks':
			result.setDate(result.getDate() + amount * 7);
			break;
		case 'days':
			result.setDate(result.getDate() + amount);
			break;
		case 'hours':
			result.setHours(result.getHours() + amount);
			break;
		case 'minutes':
			result.setMinutes(result.getMinutes() + amount);
			break;
		case 'seconds':
			result.setSeconds(result.getSeconds() + amount);
			break;
		case 'milliseconds':
			result.setMilliseconds(result.getMilliseconds() + amount);
			break;
	}
	return result;
}

function roundDown(date: Date, unit: RoundUnit): Date {
	const result = new Date(date.getTime());
	switch (unit) {
		case 'year':
			return new Date(result.getFullYear(), 0, 1);
		case 'month':
			return new Date(result.getFullYear(), result.getMonth(), 1);
		case 'week': {
			const dayOfWeek = result.getDay();
			const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday as start of week
			const monday = new Date(result.getFullYear(), result.getMonth(), result.getDate() - diff);
			return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
		}
		case 'day':
			return new Date(result.getFullYear(), result.getMonth(), result.getDate());
		case 'hour':
			return new Date(result.getFullYear(), result.getMonth(), result.getDate(), result.getHours());
		case 'minute':
			return new Date(
				result.getFullYear(),
				result.getMonth(),
				result.getDate(),
				result.getHours(),
				result.getMinutes(),
			);
		case 'second':
			return new Date(
				result.getFullYear(),
				result.getMonth(),
				result.getDate(),
				result.getHours(),
				result.getMinutes(),
				result.getSeconds(),
			);
	}
}

function roundUp(date: Date, unit: RoundUnit): Date {
	const floored = roundDown(date, unit);
	if (floored.getTime() === date.getTime()) {
		return date;
	}
	return addDuration(floored, 1, `${unit}s` as TimeUnit);
}

function formatDate(
	date: Date,
	format: string,
	locale: string,
): string {
	switch (format) {
		case 'iso':
			return date.toISOString();
		case 'isoDate':
			return date.toISOString().split('T')[0];
		case 'isoTime':
			return date.toISOString().split('T')[1].replace('Z', '');
		case 'locale':
			return new Intl.DateTimeFormat(locale, {
				dateStyle: 'medium',
				timeStyle: 'medium',
			}).format(date);
		case 'localeDate':
			return new Intl.DateTimeFormat(locale, {
				dateStyle: 'medium',
			}).format(date);
		case 'localeTime':
			return new Intl.DateTimeFormat(locale, {
				timeStyle: 'medium',
			}).format(date);
		case 'unixTimestamp':
			return String(Math.floor(date.getTime() / 1000));
		case 'unixTimestampMs':
			return String(date.getTime());
		case 'MM/dd/yyyy':
			return padTwo(date.getMonth() + 1) + '/' + padTwo(date.getDate()) + '/' + date.getFullYear();
		case 'yyyy-MM-dd':
			return date.getFullYear() + '-' + padTwo(date.getMonth() + 1) + '-' + padTwo(date.getDate());
		case 'dd/MM/yyyy':
			return padTwo(date.getDate()) + '/' + padTwo(date.getMonth() + 1) + '/' + date.getFullYear();
		case 'custom':
			// handled by caller
			return date.toISOString();
		default:
			return date.toISOString();
	}
}

function padTwo(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function applyCustomFormat(date: Date, pattern: string): string {
	const tokens: Record<string, string> = {
		yyyy: String(date.getFullYear()),
		yy: String(date.getFullYear()).slice(-2),
		MM: padTwo(date.getMonth() + 1),
		M: String(date.getMonth() + 1),
		dd: padTwo(date.getDate()),
		d: String(date.getDate()),
		HH: padTwo(date.getHours()),
		H: String(date.getHours()),
		hh: padTwo(date.getHours() % 12 || 12),
		h: String(date.getHours() % 12 || 12),
		mm: padTwo(date.getMinutes()),
		m: String(date.getMinutes()),
		ss: padTwo(date.getSeconds()),
		s: String(date.getSeconds()),
		SSS: String(date.getMilliseconds()).padStart(3, '0'),
		a: date.getHours() < 12 ? 'AM' : 'PM',
	};

	let result = pattern;
	// Replace longest tokens first to avoid partial matches
	const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
	for (const token of sortedKeys) {
		result = result.split(token).join(tokens[token]);
	}
	return result;
}

function extractDatePart(date: Date, part: DatePart): number {
	switch (part) {
		case 'year':
			return date.getFullYear();
		case 'month':
			return date.getMonth() + 1;
		case 'day':
			return date.getDate();
		case 'hour':
			return date.getHours();
		case 'minute':
			return date.getMinutes();
		case 'second':
			return date.getSeconds();
		case 'millisecond':
			return date.getMilliseconds();
		case 'dayOfWeek':
			return date.getDay();
		case 'weekNumber': {
			const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
			const dayNum = target.getUTCDay() || 7;
			target.setUTCDate(target.getUTCDate() + 4 - dayNum);
			const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
			return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
		}
	}
}

function getTimeBetween(startDate: Date, endDate: Date, unit: TimeUnit): number {
	const diffMs = endDate.getTime() - startDate.getTime();
	return diffMs / TIME_UNIT_TO_MS[unit];
}

export class DateTime implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Date & Time',
		name: 'n0n-nodes.dateTime',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Manipulate date and time values',
		defaults: {
			name: 'Date & Time',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// --- Operation selector ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Format Date',
						value: 'formatDate',
						description: 'Convert a date to a different format',
						action: 'Format a date',
					},
					{
						name: 'Calculate Date',
						value: 'calculateDate',
						description: 'Add or subtract time from a date',
						action: 'Calculate a date',
					},
					{
						name: 'Get Time Between Dates',
						value: 'getTimeBetweenDates',
						description: 'Get the difference between two dates',
						action: 'Get time between two dates',
					},
					{
						name: 'Extract Date Part',
						value: 'extractDate',
						description: 'Extract part of a date (year, month, day, etc.)',
						action: 'Extract part of a date',
					},
					{
						name: 'Round Date',
						value: 'roundDate',
						description: 'Round a date to the nearest unit',
						action: 'Round a date',
					},
				],
				default: 'formatDate',
			},

			// ===== formatDate =====
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				description: 'The date to format',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['formatDate'],
					},
				},
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['formatDate'],
					},
				},
				options: [
					{ name: 'ISO 8601', value: 'iso', description: 'Example: 2026-01-15T09:30:00.000Z' },
					{ name: 'ISO Date', value: 'isoDate', description: 'Example: 2026-01-15' },
					{ name: 'ISO Time', value: 'isoTime', description: 'Example: 09:30:00.000' },
					{ name: 'Locale String', value: 'locale', description: 'Formatted using browser locale' },
					{ name: 'Locale Date', value: 'localeDate', description: 'Date part only using locale' },
					{ name: 'Locale Time', value: 'localeTime', description: 'Time part only using locale' },
					{ name: 'Unix Timestamp (seconds)', value: 'unixTimestamp', description: 'Example: 1672531200' },
					{ name: 'Unix Timestamp (ms)', value: 'unixTimestampMs', description: 'Example: 1672531200000' },
					{ name: 'MM/DD/YYYY', value: 'MM/dd/yyyy', description: 'Example: 01/15/2026' },
					{ name: 'YYYY-MM-DD', value: 'yyyy-MM-dd', description: 'Example: 2026-01-15' },
					{ name: 'DD/MM/YYYY', value: 'dd/MM/yyyy', description: 'Example: 15/01/2026' },
					{ name: 'Custom Format', value: 'custom', description: 'Define your own format pattern' },
				],
				default: 'iso',
			},
			{
				displayName: 'Custom Format Pattern',
				name: 'customFormat',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['formatDate'],
						format: ['custom'],
					},
				},
				default: 'yyyy-MM-dd HH:mm:ss',
				description:
					'Tokens: yyyy (year), MM (month), dd (day), HH (24h hour), hh (12h hour), mm (minutes), ss (seconds), SSS (ms), a (AM/PM)',
			},
			{
				displayName: 'Output Field Name',
				name: 'outputFieldName',
				type: 'string',
				default: 'formattedDate',
				description: 'Name of the output field',
				displayOptions: {
					show: {
						operation: ['formatDate'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['formatDate'],
					},
				},
				options: [
					{
						displayName: 'Include Input Fields',
						name: 'includeInputFields',
						type: 'boolean',
						default: false,
						description: 'Whether to include all input fields in the output',
					},
					{
						displayName: 'Locale',
						name: 'locale',
						type: 'string',
						default: 'en-US',
						description: 'Locale for locale-based formatting (e.g. en-US, de-DE, ja-JP)',
					},
				],
			},

			// ===== calculateDate =====
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				description: 'The base date',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
			},
			{
				displayName: 'Mode',
				name: 'calcMode',
				type: 'options',
				options: [
					{ name: 'Add', value: 'add' },
					{ name: 'Subtract', value: 'subtract' },
				],
				default: 'add',
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
			},
			{
				displayName: 'Duration',
				name: 'duration',
				type: 'number',
				description: 'The number of units to add or subtract',
				default: 0,
				required: true,
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
			},
			{
				displayName: 'Time Unit',
				name: 'timeUnit',
				type: 'options',
				options: [
					{ name: 'Years', value: 'years' },
					{ name: 'Months', value: 'months' },
					{ name: 'Weeks', value: 'weeks' },
					{ name: 'Days', value: 'days' },
					{ name: 'Hours', value: 'hours' },
					{ name: 'Minutes', value: 'minutes' },
					{ name: 'Seconds', value: 'seconds' },
					{ name: 'Milliseconds', value: 'milliseconds' },
				],
				default: 'days',
				required: true,
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
			},
			{
				displayName: 'Output Field Name',
				name: 'outputFieldName',
				type: 'string',
				default: 'newDate',
				description: 'Name of the output field',
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['calculateDate'],
					},
				},
				options: [
					{
						displayName: 'Include Input Fields',
						name: 'includeInputFields',
						type: 'boolean',
						default: false,
						description: 'Whether to include all input fields in the output',
					},
				],
			},

			// ===== getTimeBetweenDates =====
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getTimeBetweenDates'],
					},
				},
			},
			{
				displayName: 'End Date',
				name: 'endDate',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getTimeBetweenDates'],
					},
				},
			},
			{
				displayName: 'Unit',
				name: 'unit',
				type: 'options',
				options: [
					{ name: 'Years', value: 'years' },
					{ name: 'Months', value: 'months' },
					{ name: 'Weeks', value: 'weeks' },
					{ name: 'Days', value: 'days' },
					{ name: 'Hours', value: 'hours' },
					{ name: 'Minutes', value: 'minutes' },
					{ name: 'Seconds', value: 'seconds' },
					{ name: 'Milliseconds', value: 'milliseconds' },
				],
				default: 'days',
				displayOptions: {
					show: {
						operation: ['getTimeBetweenDates'],
					},
				},
			},
			{
				displayName: 'Output Field Name',
				name: 'outputFieldName',
				type: 'string',
				default: 'timeDifference',
				description: 'Name of the output field',
				displayOptions: {
					show: {
						operation: ['getTimeBetweenDates'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['getTimeBetweenDates'],
					},
				},
				options: [
					{
						displayName: 'Include Input Fields',
						name: 'includeInputFields',
						type: 'boolean',
						default: false,
						description: 'Whether to include all input fields in the output',
					},
				],
			},

			// ===== extractDate =====
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				description: 'The date to extract a part from',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['extractDate'],
					},
				},
			},
			{
				displayName: 'Part',
				name: 'part',
				type: 'options',
				options: [
					{ name: 'Year', value: 'year' },
					{ name: 'Month', value: 'month' },
					{ name: 'Day', value: 'day' },
					{ name: 'Hour', value: 'hour' },
					{ name: 'Minute', value: 'minute' },
					{ name: 'Second', value: 'second' },
					{ name: 'Millisecond', value: 'millisecond' },
					{ name: 'Day of Week', value: 'dayOfWeek' },
					{ name: 'Week Number', value: 'weekNumber' },
				],
				default: 'month',
				displayOptions: {
					show: {
						operation: ['extractDate'],
					},
				},
			},
			{
				displayName: 'Output Field Name',
				name: 'outputFieldName',
				type: 'string',
				default: 'datePart',
				description: 'Name of the output field',
				displayOptions: {
					show: {
						operation: ['extractDate'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['extractDate'],
					},
				},
				options: [
					{
						displayName: 'Include Input Fields',
						name: 'includeInputFields',
						type: 'boolean',
						default: false,
						description: 'Whether to include all input fields in the output',
					},
				],
			},

			// ===== roundDate =====
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				description: 'The date to round',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['roundDate'],
					},
				},
			},
			{
				displayName: 'Mode',
				name: 'roundMode',
				type: 'options',
				options: [
					{ name: 'Round Down (Floor)', value: 'roundDown' },
					{ name: 'Round Up (Ceil)', value: 'roundUp' },
				],
				default: 'roundDown',
				displayOptions: {
					show: {
						operation: ['roundDate'],
					},
				},
			},
			{
				displayName: 'To Nearest',
				name: 'roundUnit',
				type: 'options',
				options: [
					{ name: 'Year', value: 'year' },
					{ name: 'Month', value: 'month' },
					{ name: 'Week', value: 'week' },
					{ name: 'Day', value: 'day' },
					{ name: 'Hour', value: 'hour' },
					{ name: 'Minute', value: 'minute' },
					{ name: 'Second', value: 'second' },
				],
				default: 'day',
				displayOptions: {
					show: {
						operation: ['roundDate'],
					},
				},
			},
			{
				displayName: 'Output Field Name',
				name: 'outputFieldName',
				type: 'string',
				default: 'roundedDate',
				description: 'Name of the output field',
				displayOptions: {
					show: {
						operation: ['roundDate'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['roundDate'],
					},
				},
				options: [
					{
						displayName: 'Include Input Fields',
						name: 'includeInputFields',
						type: 'boolean',
						default: false,
						description: 'Whether to include all input fields in the output',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as Operation;

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const includeInputFields = options.includeInputFields === true;
				const item: INodeExecutionData = includeInputFields
					? { json: { ...items[i].json }, binary: items[i].binary }
					: { json: {} };
				item.pairedItem = { item: i };

				const outputFieldName = this.getNodeParameter('outputFieldName', i) as string;

				if (operation === 'formatDate') {
					const dateInput = this.getNodeParameter('date', i) as string;
					const format = this.getNodeParameter('format', i) as string;
					const locale = (options.locale as string) || 'en-US';
					const date = parseInputDate(dateInput, i, this.getNode());

					if (format === 'custom') {
						const customFormat = this.getNodeParameter('customFormat', i) as string;
						item.json[outputFieldName] = applyCustomFormat(date, customFormat);
					} else {
						item.json[outputFieldName] = formatDate(date, format, locale);
					}
				} else if (operation === 'calculateDate') {
					const dateInput = this.getNodeParameter('date', i) as string;
					const calcMode = this.getNodeParameter('calcMode', i) as 'add' | 'subtract';
					const duration = this.getNodeParameter('duration', i) as number;
					const timeUnit = this.getNodeParameter('timeUnit', i) as TimeUnit;
					const date = parseInputDate(dateInput, i, this.getNode());

					const amount = calcMode === 'subtract' ? -duration : duration;
					const result = addDuration(date, amount, timeUnit);
					item.json[outputFieldName] = result.toISOString();
				} else if (operation === 'getTimeBetweenDates') {
					const startInput = this.getNodeParameter('startDate', i) as string;
					const endInput = this.getNodeParameter('endDate', i) as string;
					const unit = this.getNodeParameter('unit', i) as TimeUnit;
					const startDate = parseInputDate(startInput, i, this.getNode());
					const endDate = parseInputDate(endInput, i, this.getNode());

					item.json[outputFieldName] = getTimeBetween(startDate, endDate, unit);
				} else if (operation === 'extractDate') {
					const dateInput = this.getNodeParameter('date', i) as string;
					const part = this.getNodeParameter('part', i) as DatePart;
					const date = parseInputDate(dateInput, i, this.getNode());

					item.json[outputFieldName] = extractDatePart(date, part);
				} else if (operation === 'roundDate') {
					const dateInput = this.getNodeParameter('date', i) as string;
					const roundMode = this.getNodeParameter('roundMode', i) as RoundMode;
					const roundUnit = this.getNodeParameter('roundUnit', i) as RoundUnit;
					const date = parseInputDate(dateInput, i, this.getNode());

					const result = roundMode === 'roundUp'
						? roundUp(date, roundUnit)
						: roundDown(date, roundUnit);
					item.json[outputFieldName] = result.toISOString();
				}

				returnData.push(item);
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
