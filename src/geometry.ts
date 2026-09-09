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

/** A bbox up to this many mm larger than the label, in either dimension, still counts as fitting. */
const FIT_TOLERANCE_MM = 1;

const ROTATE_WARNING = 'Page rotated 90 degrees to fit the label.';

/**
 * eBay, Royal Mail Click & Drop and similar always emit an A4 source page (SPEC intro). The
 * "half the page or more" integrated-template heuristic is a property of that SOURCE page,
 * not of whatever target sheet the label is being placed onto (a bbox occupying most of a
 * small thermal label's page is normal, not a despatch note). Fixed rather than sheet.page.
 */
const SOURCE_PAGE_AREA_MM2 = 210 * 297;

/** Non-negotiable 5: the warning shown whenever --allow-scale actually shrinks a bbox. */
function scaleWarning(scale: number): string {
  return (
    `Shrunk to fit: scale ${scale.toFixed(4)}. Shrinking the datamatrix can push its module ` +
    'size below what a 203 dpi print head resolves, producing a label that looks fine and ' +
    'will not scan.'
  );
}

/** The label rectangle for 1-based position `pos` (left-to-right, top-to-bottom). Throws RangeError on a bad pos. */
export function labelBox(sheet: Sheet, pos: number): Box {
  const count = sheet.cols * sheet.rows;
  if (!Number.isInteger(pos) || pos < 1 || pos > count) {
    throw new RangeError(`pos ${pos} is outside 1..${count} for sheet "${sheet.id}"`);
  }
  const col = (pos - 1) % sheet.cols;
  const row = Math.floor((pos - 1) / sheet.cols);
  return {
    x: sheet.marginLeft + col * (sheet.label.w + sheet.gapX),
    y: sheet.marginTop + row * (sheet.label.h + sheet.gapY),
    w: sheet.label.w,
    h: sheet.label.h,
  };
}

/** Whether a w x h box fits within a target.w x target.h box, allowing the fit tolerance. */
function fitsWithin(w: number, h: number, targetW: number, targetH: number): boolean {
  return w <= targetW + FIT_TOLERANCE_MM && h <= targetH + FIT_TOLERANCE_MM;
}

/**
 * Detection sanity check, run before placement.
 * 'integrated': bbox area is >= 50% of the page. Almost certainly a Click & Drop integrated
 *   label + despatch note page. See INTEGRATED_MESSAGE in pipeline.ts.
 * 'too-large': bbox does not fit the sheet's label in either orientation. A detection
 *   failure, NOT a large label.
 */
export function classify(bbox: Box, sheet: Sheet): Classification {
  const bboxArea = bbox.w * bbox.h;
  if (bboxArea >= 0.5 * SOURCE_PAGE_AREA_MM2) return 'integrated';

  const fitsNormal = fitsWithin(bbox.w, bbox.h, sheet.label.w, sheet.label.h);
  const fitsRotated = fitsWithin(bbox.w, bbox.h, sheet.label.h, sheet.label.w);
  if (!fitsNormal && !fitsRotated) return 'too-large';
  return 'ok';
}

/**
 * Centre (default) or top-left align the measured bbox within labelBox(sheet, pos).
 * Never infer which position the input occupied; never preserve its inset.
 * Rotation (exact 90) is permitted only when sheet.cols * sheet.rows === 1 and the bbox fits
 * only when turned. Throws PlacementError when the bbox does not fit (unless allowScale).
 */
export function place(bbox: Box, sheet: Sheet, pos: number, opts: PlaceOptions = {}): Placement {
  const align = opts.align ?? 'centre';
  const nudge = opts.nudge ?? { x: 0, y: 0 };
  const target = labelBox(sheet, pos);
  const warnings: string[] = [];

  const fitsNormal = fitsWithin(bbox.w, bbox.h, target.w, target.h);
  const canRotate = sheet.cols * sheet.rows === 1;
  const fitsRotated = canRotate && fitsWithin(bbox.w, bbox.h, target.h, target.w);

  let rotate: 0 | 90 = 0;
  let effectiveTarget = target;
  let scale = 1;

  if (!fitsNormal && fitsRotated) {
    rotate = 90;
    // Transpose the target box into the drawn (swapped) page space: swap x/y and w/h.
    effectiveTarget = { x: target.y, y: target.x, w: target.h, h: target.w };
    warnings.push(ROTATE_WARNING);
  } else if (!fitsNormal && !fitsRotated) {
    if (!opts.allowScale) {
      throw new PlacementError(
        `Measured bbox ${bbox.w.toFixed(1)}x${bbox.h.toFixed(1)}mm does not fit label ` +
          `${sheet.label.w}x${sheet.label.h}mm (sheet "${sheet.id}", position ${pos}) in ` +
          'either orientation. Use --allow-scale to shrink, or check detection with --assume-position.',
      );
    }
    scale = Math.min(sheet.label.w / bbox.w, sheet.label.h / bbox.h);
    warnings.push(scaleWarning(scale));
  }

  const scaledW = bbox.w * scale;
  const scaledH = bbox.h * scale;
  let dx: number;
  let dy: number;
  if (align === 'top-left') {
    dx = effectiveTarget.x - scale * bbox.x;
    dy = effectiveTarget.y - scale * bbox.y;
  } else {
    dx = effectiveTarget.x + (effectiveTarget.w - scaledW) / 2 - scale * bbox.x;
    dy = effectiveTarget.y + (effectiveTarget.h - scaledH) / 2 - scale * bbox.y;
  }

  dx += nudge.x;
  dy += nudge.y;

  return { dx, dy, rotate, scale, warnings };
}

/**
 * Convert a Placement to the PDF-space translation (points, bottom-left origin) for
 * `scale 0 0 scale tx ty cm` before drawing the source page as a form XObject.
 * src is the source page MediaBox in mm (x/y = MediaBox origin, usually 0/0); out is the
 * output page as drawn (already swapped if placement.rotate is 90).
 *
 * Convention: a source content-stream point (Xpt, Ypt), in the source page's own PDF point
 * space, maps under the `cm` matrix to (scale*Xpt + tx, scale*Ypt + ty) on the output page.
 * Equivalently, in top-left mm space: outputPoint = scale * sourcePoint + (dx, dy), where
 * sourcePoint is measured from the source page's own top-left corner. For scale === 1 this
 * reduces to:
 *   tx = pt(dx) - pt(src.x)
 *   ty = pt(out.h - src.h) - pt(dy) - pt(src.y)
 * The general (scale-aware) form used here:
 *   tx = pt(dx) - scale * pt(src.x)
 *   ty = pt(out.h - scale * (src.y + src.h)) - pt(dy)
 */
export function pdfTranslation(p: Placement, src: Box, out: Size): { tx: number; ty: number } {
  const tx = pt(p.dx) - p.scale * pt(src.x);
  const ty = pt(out.h - p.scale * (src.y + src.h)) - pt(p.dy);
  return { tx, ty };
}
