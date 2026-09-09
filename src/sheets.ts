// Sheet definitions. Browser-safe: no file I/O here. The CLI reads a user's override file
// and passes the parsed JSON to validateSheets().
import type { Sheet } from './geometry.ts';
import bundled from '../sheets.json' with { type: 'json' };

const NUMBER_FIELDS = ['marginLeft', 'marginTop', 'gapX', 'gapY'] as const;
const POSITIVE_INT_FIELDS = ['cols', 'rows'] as const;

function isSize(v: unknown): v is { w: number; h: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as { w?: unknown }).w) &&
    Number.isFinite((v as { h?: unknown }).h)
  );
}

/** Validate a parsed sheets.json ({ sheets: [...] }). Throws with a message naming the bad field. */
export function validateSheets(json: unknown): Sheet[] {
  if (typeof json !== 'object' || json === null || !('sheets' in json)) {
    throw new Error('sheets.json: expected an object with a "sheets" array');
  }
  const sheets = (json as { sheets: unknown }).sheets;
  if (!Array.isArray(sheets)) throw new Error('sheets.json: "sheets" must be an array');

  sheets.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`sheet[${i}]: must be an object`);
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id : undefined;
    const where = `sheet[${i}]${id ? ` (id "${id}")` : ''}`;

    if (typeof s.id !== 'string' || s.id === '') throw new Error(`${where}: "id" must be a non-empty string`);
    if (typeof s.name !== 'string' || s.name === '') throw new Error(`${where}: "name" must be a non-empty string`);
    if (!Array.isArray(s.aliases) || !s.aliases.every((a) => typeof a === 'string')) {
      throw new Error(`${where}: "aliases" must be an array of strings`);
    }
    if (!isSize(s.page) || s.page.w <= 0 || s.page.h <= 0) {
      throw new Error(`${where}: "page" must be a {w,h} of positive finite numbers`);
    }
    if (!isSize(s.label) || s.label.w <= 0 || s.label.h <= 0) {
      throw new Error(`${where}: "label" must be a {w,h} of positive finite numbers`);
    }
    for (const f of POSITIVE_INT_FIELDS) {
      const v = s[f];
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        throw new Error(`${where}: "${f}" must be a positive integer`);
      }
    }
    for (const f of NUMBER_FIELDS) {
      const v = s[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error(`${where}: "${f}" must be a non-negative finite number`);
      }
    }
    if (typeof s.source !== 'string' || s.source === '') throw new Error(`${where}: "source" must be a non-empty string`);

    const page = s.page as { w: number; h: number };
    const lbl = s.label as { w: number; h: number };
    const cols = s.cols as number;
    const rows = s.rows as number;
    const marginLeft = s.marginLeft as number;
    const marginTop = s.marginTop as number;
    const gapX = s.gapX as number;
    const gapY = s.gapY as number;
    const totalW = marginLeft * 2 + cols * lbl.w + (cols - 1) * gapX;
    const totalH = marginTop * 2 + rows * lbl.h + (rows - 1) * gapY;
    if (totalW > page.w + 1e-6 || totalH > page.h + 1e-6) {
      throw new Error(`${where}: label grid (${totalW}mm x ${totalH}mm) does not fit the page (${page.w}mm x ${page.h}mm)`);
    }
  });

  return sheets as Sheet[];
}

export const BUILTIN_SHEETS: Sheet[] = validateSheets(bundled);

/** Look up by id or alias, case-insensitive. Throws with the list of known ids when not found. */
export function findSheet(idOrAlias: string, sheets: Sheet[] = BUILTIN_SHEETS): Sheet {
  const needle = idOrAlias.toLowerCase();
  const found = sheets.find(
    (s) => s.id.toLowerCase() === needle || s.aliases.some((a) => a.toLowerCase() === needle),
  );
  if (!found) {
    const known = sheets.map((s) => s.id).join(', ');
    throw new Error(`Unknown sheet "${idOrAlias}". Known ids: ${known}`);
  }
  return found;
}
