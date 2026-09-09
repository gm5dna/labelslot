// Sheet definitions. Browser-safe: no file I/O here. The CLI reads a user's override file
// and passes the parsed JSON to validateSheets().
import type { Sheet } from './geometry.ts';
import bundled from '../sheets.json' with { type: 'json' };

export const BUILTIN_SHEETS: Sheet[] = bundled.sheets;

/** Validate a parsed sheets.json ({ sheets: [...] }). Throws with a message naming the bad field. */
export function validateSheets(json: unknown): Sheet[] {
  throw new Error('not implemented');
}

/** Look up by id or alias, case-insensitive. Throws with the list of known ids when not found. */
export function findSheet(idOrAlias: string, sheets: Sheet[] = BUILTIN_SHEETS): Sheet {
  throw new Error('not implemented');
}
