import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { measure, measurePage, type CreateCanvas } from '../src/measure.ts';
import { classify, pt, type Box } from '../src/geometry.ts';
import { findSheet } from '../src/sheets.ts';
import { makeLabelPdf, REF_LABEL, A4 } from './fixtures.ts';

const ll04 = findSheet('ll04');

const near = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

const nearBox = (bbox: Box, ref: Box, tol: number, msg: string) => {
  near(bbox.x, ref.x, tol, `${msg} x`);
  near(bbox.y, ref.y, tol, `${msg} y`);
  near(bbox.w, ref.w, tol, `${msg} w`);
  near(bbox.h, ref.h, tol, `${msg} h`);
};

test('plain fixture: bbox near REF_LABEL, page is A4 at the origin', async () => {
  const pdf = await makeLabelPdf();
  const { bbox, page } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox, REF_LABEL, 0.8, 'plain bbox');
  nearBox(page, { x: 0, y: 0, w: A4.w, h: A4.h }, 0.01, 'page');
});

test('a Buffer (as readFileSync returns) works and is left untouched', async () => {
  const bytes = await makeLabelPdf();
  const buf = Buffer.from(bytes);
  const { bbox } = await measure(buf, 0, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox, REF_LABEL, 0.8, 'buffer bbox');
  // pdf.js transfers/detaches the array it's handed, truncating it to length 0; measure()
  // must copy first so the caller's buffer is unaffected.
  assert.equal(buf.length, bytes.length);
});

for (const variant of ['whiteBackground', 'clipPath', 'invisibleText'] as const) {
  test(`${variant} adds no ink: bbox matches the plain fixture`, async () => {
    const plain = await makeLabelPdf();
    const withVariant = await makeLabelPdf({ [variant]: true });
    const plainResult = await measure(plain, 0, { createCanvas });
    const variantResult = await measure(withVariant, 0, { createCanvas });
    assert.ok(plainResult.bbox);
    assert.ok(variantResult.bbox);
    nearBox(variantResult.bbox, plainResult.bbox, 0.1, variant);
  });
}

test('integrated fixture: bbox covers >= 50% of the page and classifies as integrated', async () => {
  const pdf = await makeLabelPdf({ integrated: true });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  const bboxArea = bbox.w * bbox.h;
  assert.ok(bboxArea >= 0.5 * A4.w * A4.h, `bbox area ${bboxArea} < half of A4`);
  assert.equal(classify(bbox, ll04), 'integrated');
});

test('mediaBoxOffset: page origin reported, bbox relative to it matches the plain fixture', async () => {
  const plain = await makeLabelPdf();
  const offset = await makeLabelPdf({ mediaBoxOffset: { x: 10, y: 20 } });
  const plainResult = await measure(plain, 0, { createCanvas });
  const offsetResult = await measure(offset, 0, { createCanvas });
  near(offsetResult.page.x, 10, 0.01, 'page.x');
  near(offsetResult.page.y, 20, 0.01, 'page.y');
  assert.ok(plainResult.bbox);
  assert.ok(offsetResult.bbox);
  nearBox(offsetResult.bbox, plainResult.bbox, 0.1, 'offset bbox');
});

// Same footprint as REF_LABEL (the fixture's text/barcode offsets are fixed mm distances from
// the label's own corner, sized for that footprint) but moved well away from (0, 0), so a
// hard-coded origin in measure() would show up as a large x/y error.
const RELOCATED_LABEL: Box = { x: 110, y: 130, w: 80.2, h: 125.2 };

test('pages: 3 measures each page independently (distinct pages, not just distinct grid patterns)', async () => {
  // pages:3 on a single fixture only varies the datamatrix grid pattern per page, so a measure()
  // that ignored pageIndex and always returned page 0 would still pass a same-content check.
  // Assemble three genuinely different pages instead: plain, blank, and relocated-label.
  const out = await PDFDocument.create();
  const plainSrc = await PDFDocument.load(await makeLabelPdf());
  const blankSrc = await PDFDocument.create();
  blankSrc.addPage([pt(A4.w), pt(A4.h)]);
  const relocatedSrc = await PDFDocument.load(await makeLabelPdf({ label: RELOCATED_LABEL }));

  const [plainPage] = await out.copyPages(plainSrc, [0]);
  const [blankPage] = await out.copyPages(blankSrc, [0]);
  const [relocatedPage] = await out.copyPages(relocatedSrc, [0]);
  out.addPage(plainPage);
  out.addPage(blankPage);
  out.addPage(relocatedPage);
  const pdf = await out.save({ useObjectStreams: false });

  const page0 = await measure(pdf, 0, { createCanvas });
  assert.ok(page0.bbox);
  nearBox(page0.bbox, REF_LABEL, 0.8, 'page 0 bbox');

  const page1 = await measure(pdf, 1, { createCanvas });
  assert.equal(page1.bbox, null);

  const page2 = await measure(pdf, 2, { createCanvas });
  assert.ok(page2.bbox);
  nearBox(page2.bbox, RELOCATED_LABEL, 0.8, 'page 2 bbox');
});

test('measurePage on a single loaded doc measures each page independently against fixed expectations', async () => {
  const out = await PDFDocument.create();
  const plainSrc = await PDFDocument.load(await makeLabelPdf());
  const blankSrc = await PDFDocument.create();
  blankSrc.addPage([pt(A4.w), pt(A4.h)]);
  const relocatedSrc = await PDFDocument.load(await makeLabelPdf({ label: RELOCATED_LABEL }));

  const [plainPage] = await out.copyPages(plainSrc, [0]);
  const [blankPage] = await out.copyPages(blankSrc, [0]);
  const [relocatedPage] = await out.copyPages(relocatedSrc, [0]);
  out.addPage(plainPage);
  out.addPage(blankPage);
  out.addPage(relocatedPage);
  const pdf = await out.save({ useObjectStreams: false });

  const loadingTask = getDocument({ data: new Uint8Array(pdf) });
  try {
    const doc = await loadingTask.promise;

    const page0 = await measurePage(doc, 0, { createCanvas });
    assert.ok(page0.bbox);
    nearBox(page0.bbox, REF_LABEL, 0.8, 'page 0 bbox');

    const page1 = await measurePage(doc, 1, { createCanvas });
    assert.equal(page1.bbox, null);

    const page2 = await measurePage(doc, 2, { createCanvas });
    assert.ok(page2.bbox);
    nearBox(page2.bbox, RELOCATED_LABEL, 0.8, 'page 2 bbox');
  } finally {
    await loadingTask.destroy();
  }
});

test('label far from the origin is measured there, not at a hard-coded origin', async () => {
  const pdf = await makeLabelPdf({ label: RELOCATED_LABEL });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox, RELOCATED_LABEL, 0.8, 'far label bbox');
});

test('dpi: 36 renders a half-size canvas and still lands close to REF_LABEL', async () => {
  const sizes: Array<{ width: number; height: number }> = [];
  const recordingCreateCanvas: CreateCanvas = (width, height) => {
    sizes.push({ width, height });
    return createCanvas(width, height);
  };
  const pdf = await makeLabelPdf();
  const { bbox } = await measure(pdf, 0, { createCanvas: recordingCreateCanvas, dpi: 36 });

  // A4 is 595.28 x 841.89 pt; at dpi 36 (scale 0.5) that's ceil(297.64) x ceil(420.945).
  // Asserting the requested canvas size catches a measure() that ignores `dpi` and always
  // renders at 72dpi (which would still, coincidentally, land near REF_LABEL).
  assert.deepEqual(sizes, [{ width: 298, height: 421 }]);

  assert.ok(bbox);
  // Pixel-quantisation/anti-aliasing halo scales with pixel size (25.4/36 = 0.71mm/px here vs
  // 0.35mm/px at 72dpi), so the tolerance is wider than the 72dpi case; measured ~1.6-1.8mm off.
  nearBox(bbox, REF_LABEL, 2, 'low-dpi bbox');
});

test('blank page: bbox is null', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([pt(A4.w), pt(A4.h)]);
  const pdf = await doc.save({ useObjectStreams: false });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.equal(bbox, null);
});
