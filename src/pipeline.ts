// Bytes in, bytes out. Every page of every input is a label. Browser-safe: no node: imports,
// no paths. The CLI and the web UI both call run().
import type { Align, Box, Placement, Sheet } from './geometry.ts';
import type { CreateCanvas } from './measure.ts';

export type RunOptions = {
  sheet: Sheet;
  /** Starting position on the sheet, 1-based. Default 1. Later labels fill following positions, spilling onto new pages. */
  pos?: number;
  align?: Align;
  nudge?: { x: number; y: number };
  allowScale?: boolean;
  /** Skip measurement; treat the input as occupying the nominal bounds of position N of `sheet`. Fallback when detection fails. */
  assumePosition?: number;
  dpi?: number;
  createCanvas: CreateCanvas;
};

export type PageReport = {
  input: number; // index into inputs
  page: number; // 0-based page within that input
  bbox: Box | null;
  placement: Placement;
  outputPage: number; // 0-based
  position: number; // 1-based position on that output page
};

export class LabelslotError extends Error {}

/** Given verbatim to the user when a page's ink covers half the page or more. Do not reword. */
export const INTEGRATED_MESSAGE =
  'The drawn content on this page covers half the page or more, so it is almost certainly a ' +
  'Royal Mail Click & Drop integrated label plus despatch note, not a bare label. labelslot ' +
  'cannot place it on a label. In Click & Drop, change your label format from the integrated ' +
  'label to the separate-label (label only) template, download the label again, and retry.';

/**
 * Measure every page independently, place each on the target, and return one PDF.
 * Fails fast (throws LabelslotError, no output) on the first page that cannot be placed:
 * too-large (a detection failure, not a large label), integrated, blank, /Rotate != 0, or a
 * CropBox that differs from the MediaBox. The message names the page and the measured size.
 */
export function run(inputs: Uint8Array[], opts: RunOptions): Promise<{ pdf: Uint8Array; report: PageReport[] }> {
  throw new Error('not implemented');
}
