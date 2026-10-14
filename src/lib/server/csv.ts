/**
 * CSV export.
 *
 * Values are quoted and internal quotes doubled, per RFC 4180. A leading
 * =, +, - or @ is prefixed with an apostrophe so a spreadsheet treats the
 * value as text rather than a formula -- a name like "=cmd" should never
 * execute when a manager opens the export.
 */

function escapeCell(value: unknown): string {
	if (value === null || value === undefined) return '""';
	let text = String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
	const lines = [headers.map(escapeCell).join(',')];
	for (const row of rows) lines.push(row.map(escapeCell).join(','));
	// BOM so Excel reads UTF-8 names correctly.
	return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
			'cache-control': 'no-store'
		}
	});
}
