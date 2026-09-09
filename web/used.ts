// Pure used-position logic for the web UI's per-sheet "used" tracking. DOM-free so it is
// testable under `node --test` without a browser. web/app.ts imports both functions.
import type { PageReport } from '../src/pipeline.ts';

/**
 * The used set to persist after a run: only the positions filled on the LAST output page (the
 * physical sheet the user is left holding). Earlier output pages in a multi-page run are full
 * printed sheets and are not tracked. When the last page is itself full, nothing carries
 * forward - the next sheet is fresh.
 */
export function nextUsed(report: PageReport[], count: number): Set<number> {
  if (report.length === 0) return new Set();
  const lastOutputPage = Math.max(...report.map((r) => r.outputPage));
  const positions = report.filter((r) => r.outputPage === lastOutputPage).map((r) => r.position);
  return positions.length >= count ? new Set() : new Set(positions);
}

/** The first 1-based position not in `used`, up to `count`. Falls back to 1 when all are used. */
export function firstUnused(used: Set<number>, count: number): number {
  for (let pos = 1; pos <= count; pos++) if (!used.has(pos)) return pos;
  return 1;
}
