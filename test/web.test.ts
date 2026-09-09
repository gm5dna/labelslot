// DOM-free tests for the web UI's pure used-position logic (web/used.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextUsed, firstUnused } from '../web/used.ts';
import type { PageReport } from '../src/pipeline.ts';

/** Hand-written report entries; nextUsed/firstUnused only look at outputPage and position. */
function fakeReport(entries: Array<{ outputPage: number; position: number }>): PageReport[] {
  return entries.map(
    (e, i): PageReport => ({
      input: 0,
      page: i,
      bbox: null,
      placement: { dx: 0, dy: 0, rotate: 0, scale: 1, warnings: [] },
      outputPage: e.outputPage,
      position: e.position,
    }),
  );
}

test('nextUsed: 6 labels spilling onto a second ll04 page (capacity 4) leaves {1,2} used, next position 3', () => {
  const report = fakeReport([
    { outputPage: 0, position: 1 },
    { outputPage: 0, position: 2 },
    { outputPage: 0, position: 3 },
    { outputPage: 0, position: 4 },
    { outputPage: 1, position: 1 },
    { outputPage: 1, position: 2 },
  ]);
  const used = nextUsed(report, 4);
  assert.deepEqual([...used].sort(), [1, 2]);
  assert.equal(firstUnused(used, 4), 3);
});

test('nextUsed: a run that exactly fills the last page leaves nothing used (fresh sheet next)', () => {
  const report = fakeReport([
    { outputPage: 0, position: 1 },
    { outputPage: 0, position: 2 },
    { outputPage: 0, position: 3 },
    { outputPage: 0, position: 4 },
  ]);
  const used = nextUsed(report, 4);
  assert.deepEqual([...used], []);
  assert.equal(firstUnused(used, 4), 1);
});
