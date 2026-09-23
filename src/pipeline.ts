// Bytes in, bytes out. Every page of every input is a label. Browser-safe: no node: imports,
// no paths. The CLI and the web UI both call run().
import { PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { classify, labelBox, mm, place, PlacementError, type Align, type Box, type Placement, type Sheet } from './geometry.ts';
import { measurePage, type CreateCanvas } from './measure.ts';
import { addOutputPage, placePage } from './transform.ts';

export type RunOptions = {
  sheet: Sheet;
  /** Starting position on the sheet, 1-based. Default 1. Later labels fill following positions, spilling onto new pages. */
  pos?: number;
  /** Positions to leave empty on the first output page only (already used on the sheet). Later pages are fresh sheets. */
  skip?: number[];
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

const CROP_BOX_TOLERANCE_PT = 0.01;

/**
 * Measure every page independently, place each on the target, and return one PDF.
 * Fails fast (throws LabelslotError, no output) on the first page that cannot be placed:
 * too-large (a detection failure, not a large label), integrated, blank, /Rotate != 0, or a
 * CropBox that differs from the MediaBox. The message names the page and the measured size.
 */
export async function run(inputs: Uint8Array[], opts: RunOptions): Promise<{ pdf: Uint8Array; report: PageReport[] }> {
  const { sheet } = opts;
  const capacity = sheet.cols * sheet.rows;
  const outDoc = await PDFDocument.create();
  const report: PageReport[] = [];

  let pos = opts.pos ?? 1;
  const skip = new Set(opts.skip);
  let outputPageIndex = -1;
  let currentPage: PDFPage | undefined;

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const bytes = inputs[inputIndex];
    const srcDoc = await PDFDocument.load(bytes);
    const srcPages = srcDoc.getPages();

    // Load the pdf.js document at most once per input, only when measurement needs it
    // (assumePosition skips measurement entirely). Loading it once and measuring every page
    // from it, rather than once per page, avoids re-parsing the whole PDF O(pages) times.
    // new Uint8Array(bytes) copies (pdf.js detaches the buffer it's given) and normalises a
    // Node Buffer to a plain Uint8Array, same as measure.ts.
    const loadingTask = opts.assumePosition == null ? getDocument({ data: new Uint8Array(bytes) }) : undefined;
    try {
      const pdfjsDoc = loadingTask ? await loadingTask.promise : undefined;

      for (let pageIndex = 0; pageIndex < srcPages.length; pageIndex++) {
        const prefix = `input ${inputIndex + 1}, page ${pageIndex + 1}`;
        const srcPage = srcPages[pageIndex];

        const rotation = srcPage.getRotation().angle;
        if (rotation !== 0) {
          throw new LabelslotError(`${prefix}: page rotation is ${rotation} degrees; only /Rotate 0 is supported`);
        }
        const mediaBox = srcPage.getMediaBox();
        const cropBox = srcPage.getCropBox();
        if (
          Math.abs(mediaBox.x - cropBox.x) > CROP_BOX_TOLERANCE_PT ||
          Math.abs(mediaBox.y - cropBox.y) > CROP_BOX_TOLERANCE_PT ||
          Math.abs(mediaBox.width - cropBox.width) > CROP_BOX_TOLERANCE_PT ||
          Math.abs(mediaBox.height - cropBox.height) > CROP_BOX_TOLERANCE_PT
        ) {
          throw new LabelslotError(
            `${prefix}: CropBox differs from MediaBox; only pages whose CropBox equals the MediaBox are supported`,
          );
        }

        let bbox: Box | null;
        let srcBox: Box;
        if (opts.assumePosition != null) {
          bbox = labelBox(sheet, opts.assumePosition);
          srcBox = { x: mm(mediaBox.x), y: mm(mediaBox.y), w: mm(mediaBox.width), h: mm(mediaBox.height) };
        } else {
          const measured = await measurePage(pdfjsDoc!, pageIndex, { createCanvas: opts.createCanvas, dpi: opts.dpi });
          bbox = measured.bbox;
          srcBox = measured.page;
        }
        if (bbox === null) throw new LabelslotError(`${prefix}: page is blank`);

        const classification = classify(bbox, sheet);
        if (classification === 'integrated') {
          throw new LabelslotError(
            `${prefix}: ${INTEGRATED_MESSAGE} (measured ${bbox.w.toFixed(1)}x${bbox.h.toFixed(1)}mm)`,
          );
        }
        if (classification === 'too-large' && !opts.allowScale) {
          throw new LabelslotError(
            `${prefix}: detection failed - measured ink ${bbox.w.toFixed(1)}x${bbox.h.toFixed(1)}mm does not fit ` +
              `label ${sheet.label.w}x${sheet.label.h}mm on sheet "${sheet.id}". This means detection likely ` +
              'picked up extra marks, not that the label itself is too large. Try --assume-position N to skip ' +
              'measurement, or --allow-scale to shrink to fit.',
          );
        }

        while (outputPageIndex <= 0 && skip.has(pos)) pos++;
        let needNewPage = outputPageIndex === -1;
        if (outputPageIndex !== -1 && pos > capacity) {
          pos = 1;
          needNewPage = true;
        }

        let placement: Placement;
        try {
          placement = place(bbox, sheet, pos, { align: opts.align, nudge: opts.nudge, allowScale: opts.allowScale });
        } catch (err) {
          if (err instanceof PlacementError) throw new LabelslotError(`${prefix}: ${err.message}`);
          throw err;
        }

        if (needNewPage) {
          currentPage = addOutputPage(outDoc, sheet, placement.rotate);
          outputPageIndex++;
        }

        await placePage(currentPage!, srcDoc, pageIndex, placement, srcBox);

        report.push({ input: inputIndex, page: pageIndex, bbox, placement, outputPage: outputPageIndex, position: pos });
        pos++;
      }
    } finally {
      if (loadingTask) await loadingTask.destroy();
    }
  }

  return { pdf: await outDoc.save(), report };
}
