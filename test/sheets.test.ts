import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_SHEETS, findSheet, validateSheets } from '../src/sheets.ts';

test('BUILTIN_SHEETS passes validateSheets and has the four seeded sheets', () => {
  const sheets = validateSheets({ sheets: BUILTIN_SHEETS });
  assert.equal(sheets.length, 4);
  assert.deepEqual(
    sheets.map((s) => s.id).sort(),
    ['6x4', 'l7168', 'll04', 'lp4-105'],
  );
});

test('findSheet: matches id or alias, case-insensitively', () => {
  assert.equal(findSheet('LL04').id, 'll04');
  assert.equal(findSheet('l7169').id, 'll04'); // alias
  assert.equal(findSheet('4X6').id, '6x4'); // alias, different case
});

test('findSheet: unknown id throws listing known ids', () => {
  assert.throws(() => findSheet('nope'), /nope/);
  assert.throws(() => findSheet('nope'), /ll04/);
});

test('validateSheets: rejects missing/bad fields with a message naming sheet and field', () => {
  assert.throws(() => validateSheets(null), /sheets/);
  assert.throws(() => validateSheets({ sheets: 'nope' }), /sheets/);
  assert.throws(
    () => validateSheets({ sheets: [{ id: 'x', name: 'X', aliases: [], page: { w: 210, h: 297 }, cols: 2, rows: 2, label: { w: 10, h: 10 }, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0 /* missing source */ }] }),
    /source/,
  );
  assert.throws(
    () => validateSheets({ sheets: [{ id: 'x', name: 'X', aliases: [], page: { w: 210, h: 297 }, cols: -1, rows: 2, label: { w: 10, h: 10 }, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, source: 's' }] }),
    /cols/,
  );
  assert.throws(
    () => validateSheets({ sheets: [{ id: 'x', name: 'X', aliases: [], page: { w: 210, h: 297 }, cols: 1, rows: 1, label: { w: 300, h: 10 }, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, source: 's' }] }),
    /fit/,
  );
});
