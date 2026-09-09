// Synthetic label PDFs for tests. Never commit a real label: they carry a customer's address.
// The default fixture mimics a real eBay 2nd Class large-letter label: 80.2 x 125.2 mm at
// 15.1 mm from the left and 16.4 mm from the top of an A4 page, with a datamatrix-like grid,
// a barcode-like row of bars, a border and some text.
import {
  PDFDocument, StandardFonts, TextRenderingMode, clip, degrees, endPath, popGraphicsState,
  pushGraphicsState, rectangle, rgb, setTextRenderingMode,
} from '@cantoo/pdf-lib';
import { pt, type Box, type Size } from '../src/geometry.ts';

export const A4: Size = { w: 210, h: 297 };
export const REF_LABEL: Box = { x: 15.1, y: 16.4, w: 80.2, h: 125.2 };
/** Datamatrix-like grid inside the label: top-left inset from the label's corner, cell count and cell size, all mm. */
export const DATAMATRIX = { inset: 5, cells: 20, cell: 1 };
/** Which grid cells are filled. Deterministic so the no-scaling proof can locate a known vector path. */
export const gridCellFilled = (i: number, j: number, page: number): boolean => (i * 7 + j * 3 + page) % 5 < 2;

export type FixtureOptions = {
  /** Labels to emit, one per page. Default 1. The grid pattern differs per page. */
  pages?: number;
  pageSize?: Size; // default A4
  label?: Box; // default REF_LABEL
  /** A full-page white filled rectangle under the label. Must not count as ink. */
  whiteBackground?: boolean;
  /** A page-wide clip path around the label. Has no ink of its own; must not count. */
  clipPath?: boolean;
  /** Text in render mode 3 (invisible) far from the label. Must not count as ink. */
  invisibleText?: boolean;
  /** A despatch-note block beside and below the label so ink covers >= 50% of the page. */
  integrated?: boolean;
  /** Set the page's /Rotate. */
  rotate?: 0 | 90;
  /** Shift the MediaBox origin away from 0,0 (mm). Content is shifted with it. */
  mediaBoxOffset?: { x: number; y: number };
};

export async function makeLabelPdf(o: FixtureOptions = {}): Promise<Uint8Array> {
  const pages = o.pages ?? 1;
  const size = o.pageSize ?? A4;
  const L = o.label ?? REF_LABEL;
  const ox = pt(o.mediaBoxOffset?.x ?? 0);
  const oy = pt(o.mediaBoxOffset?.y ?? 0);
  const W = pt(size.w);
  const H = pt(size.h);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  // mm, top-left page coords -> pt, bottom-left PDF coords (of the box's bottom-left corner)
  const X = (mmX: number) => ox + pt(mmX);
  const Y = (mmTop: number, mmH = 0) => oy + H - pt(mmTop + mmH);

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    if (ox || oy) page.setMediaBox(ox, oy, W, H);
    if (o.rotate) page.setRotation(degrees(o.rotate));
    if (o.whiteBackground) page.drawRectangle({ x: ox, y: oy, width: W, height: H, color: rgb(1, 1, 1) });
    if (o.clipPath) page.pushOperators(pushGraphicsState(), rectangle(X(5), Y(size.h - 5), W - pt(10), H - pt(10)), clip(), endPath());

    page.drawRectangle({ x: X(L.x), y: Y(L.y, L.h), width: pt(L.w), height: pt(L.h), borderWidth: 0.5, borderColor: black });
    const g = DATAMATRIX;
    for (let i = 0; i < g.cells; i++) for (let j = 0; j < g.cells; j++) if (gridCellFilled(i, j, p))
      page.drawRectangle({ x: X(L.x + g.inset + i * g.cell), y: Y(L.y + g.inset + (j + 1) * g.cell, 0), width: pt(g.cell), height: pt(g.cell), color: black });
    for (let b = 0, x = L.x + 6; x < L.x + L.w - 6; b++, x += 1 + (b % 3))
      page.drawRectangle({ x: X(x), y: Y(L.y + L.h - 18, 12), width: pt(0.5 + (b % 2) * 0.5), height: pt(12), color: black });
    page.drawText(`LABEL ${p + 1} / ${pages}`, { x: X(L.x + 30), y: Y(L.y + 10), size: 10, font, color: black });
    page.drawText('TEST CUSTOMER\n1 EXAMPLE STREET\nTESTTOWN\nAB1 2CD', { x: X(L.x + 5), y: Y(L.y + 40), size: 11, font, lineHeight: 14, color: black });

    if (o.integrated) {
      page.drawRectangle({ x: X(L.x), y: Y(size.h - 10, 0), width: pt(size.w - 2 * L.x), height: pt(size.h - 10 - (L.y + L.h + 10)), borderWidth: 0.5, borderColor: black });
      page.drawText('DESPATCH NOTE', { x: X(size.w - 60), y: Y(20), size: 12, font, color: black });
    }
    if (o.invisibleText) {
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
      page.drawText('INVISIBLE', { x: X(size.w - 30), y: Y(size.h - 10), size: 12, font, color: black });
      page.pushOperators(popGraphicsState());
    }
    if (o.clipPath) page.pushOperators(popGraphicsState());
  }
  return doc.save({ useObjectStreams: false });
}
