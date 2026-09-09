// PDF output with @cantoo/pdf-lib. The source page is embedded as a form XObject (its content
// stream copied verbatim, /Matrix identity) and drawn with a pure translation. Never scaled,
// never rasterised. Browser-safe.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { labelBox, mm, pt, pdfTranslation, type Box, type Placement, type Sheet } from './geometry.ts';

/**
 * Add a page sized for the sheet. When rotate is 90 the MediaBox is sheet.page with w/h
 * swapped and the page's /Rotate is set to 90, so it displays and prints in the media's
 * orientation with the content turned. Content is never rotated in the content stream.
 */
export function addOutputPage(doc: PDFDocument, sheet: Sheet, rotate: 0 | 90): PDFPage {
  const w = rotate === 90 ? sheet.page.h : sheet.page.w;
  const h = rotate === 90 ? sheet.page.w : sheet.page.h;
  const page = doc.addPage([pt(w), pt(h)]);
  if (rotate === 90) page.setRotation(degrees(90));
  return page;
}

/**
 * Embed page `pageIndex` of `src` into `page` and draw it with `1 0 0 1 tx ty cm` from
 * geometry.pdfTranslation(). If placement.scale !== 1 (only possible via --allow-scale) the
 * XObject is drawn with that scale and the caller has already warned.
 * srcBox is the source page MediaBox in mm (from measure()).
 */
export async function placePage(page: PDFPage, src: PDFDocument, pageIndex: number, placement: Placement, srcBox: Box): Promise<void> {
  const embedded = await page.doc.embedPage(src.getPage(pageIndex));
  const size = page.getSize();
  const { tx, ty } = pdfTranslation(placement, srcBox, { w: mm(size.width), h: mm(size.height) });
  if (placement.scale === 1) {
    page.drawPage(embedded, { x: tx, y: ty });
  } else {
    page.drawPage(embedded, { x: tx, y: ty, xScale: placement.scale, yScale: placement.scale });
  }
}

const GREY = rgb(0.6, 0.6, 0.6);
const BLACK = rgb(0, 0, 0);
const CROSSHAIR_MM = 10; // total hairline length, centred on the corner
const RULE_MM = 10; // ruler span along each of the top-left corner's arms

/**
 * A rectangle in mm, top-left origin, mapped to a PDF drawRectangle call (bottom-left anchor)
 * on a page of the given mm height.
 */
function rectAt(page: PDFPage, box: Box, pageHeightMm: number, borderColor = GREY): void {
  page.drawRectangle({
    x: pt(box.x),
    y: pt(pageHeightMm - (box.y + box.h)),
    width: pt(box.w),
    height: pt(box.h),
    borderWidth: 0.2,
    borderColor,
  });
}

/** One crosshair (two 10mm hairlines) at (cx, cy) mm, top-left origin. For the top-left
 * corner of a position also draws a 0/5/10 mm rule along the two arms leading into the label. */
function crosshair(page: PDFPage, font: PDFFont, cx: number, cy: number, pageHeightMm: number, isTopLeft: boolean, arm: { dx: 1 | -1; dy: 1 | -1 }): void {
  const toPdf = (x: number, y: number) => ({ x: pt(x), y: pt(pageHeightMm - y) });
  const half = CROSSHAIR_MM / 2;
  const h1 = toPdf(cx - half, cy);
  const h2 = toPdf(cx + half, cy);
  const v1 = toPdf(cx, cy - half);
  const v2 = toPdf(cx, cy + half);
  page.drawLine({ start: h1, end: h2, thickness: 0.3, color: BLACK });
  page.drawLine({ start: v1, end: v2, thickness: 0.3, color: BLACK });

  if (!isTopLeft) return;

  // Ruler along the horizontal arm (x direction, into the label) and the vertical arm
  // (y direction, into the label). Ticks every 1mm, longer every 5mm, labelled 0/5/10.
  for (let t = 0; t <= RULE_MM; t++) {
    const long = t % 5 === 0;
    const tickLen = long ? 0.8 : 0.4;

    const hx = cx + arm.dx * t;
    const hTick = toPdf(hx, cy);
    const hTickEnd = toPdf(hx, cy + arm.dy * tickLen);
    page.drawLine({ start: hTick, end: hTickEnd, thickness: 0.2, color: BLACK });

    const vy = cy + arm.dy * t;
    const vTick = toPdf(cx, vy);
    const vTickEnd = toPdf(cx + arm.dx * tickLen, vy);
    page.drawLine({ start: vTick, end: vTickEnd, thickness: 0.2, color: BLACK });

    if (long) {
      const labelPt = toPdf(hx, cy + arm.dy * (tickLen + 1.2));
      page.drawText(String(t), { x: labelPt.x, y: labelPt.y, size: 4, font, color: BLACK });
      const vLabelPt = toPdf(cx + arm.dx * (tickLen + 1.2), vy);
      page.drawText(String(t), { x: vLabelPt.x, y: vLabelPt.y, size: 4, font, color: BLACK });
    }
  }
}

/**
 * A calibration page for the sheet: crosshairs and a mm rule at every label's corners so a
 * user can find the nudge for their printer once. Returned as PDF bytes.
 */
export async function calibrationPage(sheet: Sheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = addOutputPage(doc, sheet, 0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageHeightMm = sheet.page.h;

  const count = sheet.cols * sheet.rows;
  let lowestY = 0;
  for (let pos = 1; pos <= count; pos++) {
    const box = labelBox(sheet, pos);
    rectAt(page, box, pageHeightMm);

    const corners: { x: number; y: number; isTopLeft: boolean; arm: { dx: 1 | -1; dy: 1 | -1 } }[] = [
      { x: box.x, y: box.y, isTopLeft: true, arm: { dx: 1, dy: 1 } },
      { x: box.x + box.w, y: box.y, isTopLeft: false, arm: { dx: -1, dy: 1 } },
      { x: box.x, y: box.y + box.h, isTopLeft: false, arm: { dx: 1, dy: -1 } },
      { x: box.x + box.w, y: box.y + box.h, isTopLeft: false, arm: { dx: -1, dy: -1 } },
    ];
    for (const c of corners) crosshair(page, font, c.x, c.y, pageHeightMm, c.isTopLeft, c.arm);

    lowestY = Math.max(lowestY, box.y + box.h);
  }

  const noteMm = Math.min(pageHeightMm - 5, lowestY + 8);
  const note =
    `${sheet.id}: ${sheet.name}. Print at 100% / Actual size. Measure printed crosshair to ` +
    'label corner; pass as --nudge X,Y (mm, +x right, +y down).';
  page.drawText(note, { x: pt(5), y: pt(pageHeightMm - noteMm), size: 7, font, color: BLACK });

  return doc.save();
}
