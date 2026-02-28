import type { IBinaryData } from 'n8n-workflow';

const MIME_TYPES: Record<string, string> = {
	txt: 'text/plain',
	html: 'text/html',
	htm: 'text/html',
	css: 'text/css',
	csv: 'text/csv',
	xml: 'application/xml',
	json: 'application/json',
	js: 'application/javascript',
	pdf: 'application/pdf',
	zip: 'application/zip',
	gz: 'application/gzip',
	tar: 'application/x-tar',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	ico: 'image/x-icon',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	mp4: 'video/mp4',
	webm: 'video/webm',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function lookupMimeType(fileName: string): string | undefined {
	const ext = fileName.split('.').pop()?.toLowerCase();
	if (!ext) return undefined;
	return MIME_TYPES[ext];
}

/** Convert a Buffer into an IBinaryData object (base64-encoded). */
export async function prepareBinaryData(
	binaryData: Buffer,
	fileName?: string,
	mimeType?: string,
): Promise<IBinaryData> {
	const resolvedMimeType =
		mimeType ||
		(fileName ? lookupMimeType(fileName) ?? 'application/octet-stream' : 'application/octet-stream');
	const fileExtension = fileName?.split('.').pop();

	return {
		data: binaryData.toString('base64'),
		mimeType: resolvedMimeType,
		fileName,
		fileExtension,
		fileSize: formatFileSize(binaryData.length),
		bytes: binaryData.length,
	};
}

/** Extract raw Buffer from a base64-encoded IBinaryData object. */
export function getBinaryDataBuffer(binaryData: IBinaryData): Buffer {
	if (!binaryData.data) {
		throw new Error('Binary data is empty');
	}
	return Buffer.from(binaryData.data, 'base64');
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
