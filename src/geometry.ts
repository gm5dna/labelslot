// Pure geometry. No I/O, no PDF library. Everything here is unit tested; this is where a
// wrong sign ruins a sheet of labels.
//
// Conventions (see docs/SPEC.md, "Coordinates"):
// - All lengths in millimetres unless the name says pt.
// - Origin is the TOP-LEFT of the page, y increases DOWNWARDS. This matches how label sheets
//   are specified. PDF's bottom-left origin appears only in pdfTranslation().

export type Size = { w: number; h: number };

/** A rectangle in mm, top-left origin. For a page's MediaBox, x/y hold the MediaBox origin. */
export type Box = { x: number; y: number; w: number; h: number };

export type Sheet = {
  id: string;
  name: string;
  aliases: string[];
  page: Size;
  cols: number;
  rows: number;
  label: Size;
  marginLeft: number;
  marginTop: number;
  gapX: number;
  gapY: number;
  /** Where the margins and gaps came from. Vendor template URL, or "by definition". */
  source: string;
};

export type Align = 'centre' | 'top-left';

export type PlaceOptions = {
  align?: Align; // default 'centre'
  nudge?: { x: number; y: number }; // mm, added to the final position; +x right, +y down
  allowScale?: boolean; // default false. Only ever used to shrink; must be reported.
};

/**
 * How to move a source page's content onto the output page.
 * dx/dy are the translation in mm, top-left convention, from the source page's coordinate
 * space to the OUTPUT PAGE AS DRAWN (before /Rotate). When rotate is 90 the drawn page is
 * sheet.page with w and h swapped, and the target label box is transposed the same way;
 * transform.ts then sets /Rotate 90 so the printed page comes out in the media's orientation.
 */
export type Placement = {
  dx: number;
  dy: number;
  rotate: 0 | 90;
  scale: number; // 1 unless allowScale kicked in
  warnings: string[];
};

export type Classification = 'ok' | 'too-large' | 'integrated';

export class PlacementError extends Error {}

export const PT_PER_MM = 72 / 25.4;
export const pt = (mm: number): number => mm * PT_PER_MM;
export const mm = (points: number): number => points / PT_PER_MM;

/** The label rectangle for 1-based position `pos` (left-to-right, top-to-bottom). Throws RangeError on a bad pos. */
export function labelBox(sheet: Sheet, pos: number): Box {
  throw new Error('not implemented');
}

/**
 * Detection sanity check, run before placement.
 * 'integrated': bbox area is >= 50% of the page. Almost certainly a Click & Drop integrated
 *   label + despatch note page. See INTEGRATED_MESSAGE in pipeline.ts.
 * 'too-large': bbox does not fit the sheet's label in either orientation. A detection
 *   failure, NOT a large label.
 */
export function classify(bbox: Box, sheet: Sheet): Classification {
  throw new Error('not implemented');
}

/**
 * Centre (default) or top-left align the measured bbox within labelBox(sheet, pos).
 * Never infer which position the input occupied; never preserve its inset.
 * Rotation (exact 90) is permitted only when sheet.cols * sheet.rows === 1 and the bbox fits
 * only when turned. Throws PlacementError when the bbox does not fit (unless allowScale).
 */
export function place(bbox: Box, sheet: Sheet, pos: number, opts: PlaceOptions = {}): Placement {
  throw new Error('not implemented');
}

/**
 * Convert a Placement to the PDF-space translation (points, bottom-left origin) for
 * `1 0 0 1 tx ty cm` before drawing the source page as a form XObject.
 * src is the source page MediaBox in mm (x/y = MediaBox origin, usually 0/0); out is the
 * output page as drawn (already swapped if placement.rotate is 90).
 *   tx = pt(dx) - pt(src.x)
 *   ty = pt(out.h - src.h) - pt(dy) - pt(src.y)
 */
export function pdfTranslation(p: Placement, src: Box, out: Size): { tx: number; ty: number } {
  throw new Error('not implemented');
}
