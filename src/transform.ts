// PDF output with @cantoo/pdf-lib. The source page is embedded as a form XObject (its content
// stream copied verbatim, /Matrix identity) and drawn with a pure translation. Never scaled,
// never rasterised. Browser-safe.
import type { PDFDocument, PDFPage } from '@cantoo/pdf-lib';
import type { Box, Placement, Sheet } from './geometry.ts';

/**
 * Add a page sized for the sheet. When rotate is 90 the MediaBox is sheet.page with w/h
 * swapped and the page's /Rotate is set to 90, so it displays and prints in the media's
 * orientation with the content turned. Content is never rotated in the content stream.
 */
export function addOutputPage(doc: PDFDocument, sheet: Sheet, rotate: 0 | 90): PDFPage {
  throw new Error('not implemented');
}

/**
 * Embed page `pageIndex` of `src` into `page` and draw it with `1 0 0 1 tx ty cm` from
 * geometry.pdfTranslation(). If placement.scale !== 1 (only possible via --allow-scale) the
 * XObject is drawn with that scale and the caller has already warned.
 * srcBox is the source page MediaBox in mm (from measure()).
 */
export function placePage(page: PDFPage, src: PDFDocument, pageIndex: number, placement: Placement, srcBox: Box): Promise<void> {
  throw new Error('not implemented');
}

/**
 * A calibration page for the sheet: crosshairs and a mm rule at every label's corners so a
 * user can find the nudge for their printer once. Returned as PDF bytes.
 */
export function calibrationPage(sheet: Sheet): Promise<Uint8Array> {
  throw new Error('not implemented');
}
