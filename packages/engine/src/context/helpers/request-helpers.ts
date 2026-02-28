import type { IHttpRequestOptions, IDataObject } from 'n8n-workflow';

export interface HttpResponse {
	body: unknown;
	headers: Record<string, string>;
	statusCode: number;
	statusMessage: string;
}

/** Make an HTTP request using native fetch. */
export async function httpRequest(options: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(options.url);

	if (options.qs) {
		for (const [key, value] of Object.entries(options.qs)) {
			if (value !== undefined && value !== null) {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const headers: Record<string, string> = {};
	if (options.headers) {
		for (const [key, value] of Object.entries(options.headers)) {
			if (value !== undefined && value !== null) {
				headers[key] = String(value);
			}
		}
	}

	// Apply basic auth from options.auth
	if (options.auth) {
		const encoded = Buffer.from(
			`${options.auth.username}:${options.auth.password}`,
		).toString('base64');
		headers['Authorization'] = `Basic ${encoded}`;
	}

	let body: string | Buffer | URLSearchParams | undefined;
	if (options.body !== undefined && options.body !== null) {
		if (options.body instanceof URLSearchParams) {
			body = options.body;
			if (!headers['Content-Type']) {
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			}
		} else if (typeof options.body === 'string') {
			body = options.body;
		} else if (Buffer.isBuffer(options.body)) {
			body = options.body;
		} else {
			body = JSON.stringify(options.body);
			if (!headers['Content-Type']) {
				headers['Content-Type'] = 'application/json';
			}
		}
	}

	const response = await fetch(url.toString(), {
		method: options.method || 'GET',
		headers,
		body,
		redirect: options.disableFollowRedirect ? 'manual' : 'follow',
		signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
	});

	if (options.returnFullResponse) {
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		return {
			body:
				options.encoding === 'arraybuffer'
					? Buffer.from(await response.arrayBuffer())
					: await parseResponseBody(response, options.json),
			headers: responseHeaders,
			statusCode: response.status,
			statusMessage: response.statusText,
		} satisfies HttpResponse;
	}

	if (options.encoding === 'arraybuffer') {
		return Buffer.from(await response.arrayBuffer());
	}

	return parseResponseBody(response, options.json);
}

async function parseResponseBody(
	response: Response,
	expectJson?: boolean,
): Promise<unknown> {
	const contentType = response.headers.get('content-type') || '';

	if (expectJson !== false && contentType.includes('application/json')) {
		return response.json();
	}

	if (expectJson) {
		const text = await response.text();
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return text;
		}
	}

	return response.text();
}

/** Make an HTTP request with credential-based authentication applied. */
export async function httpRequestWithAuthentication(
	options: IHttpRequestOptions,
	_credentialType: string,
	credentials: IDataObject,
): Promise<unknown> {
	const authenticatedOptions: IHttpRequestOptions = {
		...options,
		headers: { ...options.headers },
	};

	// Basic auth
	if (credentials.user && credentials.password) {
		const encoded = Buffer.from(
			`${credentials.user}:${credentials.password}`,
		).toString('base64');
		(authenticatedOptions.headers as Record<string, string>)['Authorization'] =
			`Basic ${encoded}`;
	}

	// Bearer token
	if (credentials.token) {
		(authenticatedOptions.headers as Record<string, string>)['Authorization'] =
			`Bearer ${credentials.token}`;
	}

	// API key in header
	if (credentials.apiKey) {
		const headerName =
			(credentials.apiKeyHeader as string) || 'X-API-Key';
		(authenticatedOptions.headers as Record<string, string>)[headerName] =
			credentials.apiKey as string;
	}

	return httpRequest(authenticatedOptions);
}
