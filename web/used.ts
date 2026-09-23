// Pure used-position logic for the web UI's per-sheet "used" tracking. DOM-free so it is
// testable under `node --test` without a browser. web/app.ts imports both functions.
import type { PageReport } from '../src/pipeline.ts';

/**
 * The used set to persist after a run, given the used set from BEFORE the run (`prev`).
 * If the whole run landed on the first output page (the sheet the user is left holding),
 * the newly-filled positions accumulate onto `prev` (an earlier partial run on this same sheet
 * is still remembered). If the run spilled onto later output pages, only the LAST page's
 * positions are tracked (the physical sheet left in the tray); earlier pages in that run are
 * full printed sheets and `prev` no longer applies to what's in the tray now. When the result
 * has every position, nothing carries forward - the next sheet is fresh.
 */
export function nextUsed(prev: Set<number>, report: PageReport[], count: number): Set<number> {
  if (report.length === 0) return prev;
  const spilled = report.some((r) => r.outputPage > 0);
  const lastOutputPage = Math.max(...report.map((r) => r.outputPage));
  const positions = report.filter((r) => r.outputPage === lastOutputPage).map((r) => r.position);
  const result = spilled ? new Set(positions) : new Set([...prev, ...positions]);
  return result.size >= count ? new Set() : result;
}

/** The first 1-based position not in `used`, up to `count`. Falls back to 1 when all are used. */
export function firstUnused(used: Set<number>, count: number): number {
  for (let pos = 1; pos <= count; pos++) if (!used.has(pos)) return pos;
  return 1;
}

