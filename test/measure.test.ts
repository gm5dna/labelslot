import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from '@cantoo/pdf-lib';
import { measure } from '../src/measure.ts';
import { classify } from '../src/geometry.ts';
import { findSheet } from '../src/sheets.ts';
import { makeLabelPdf, REF_LABEL, A4 } from './fixtures.ts';

const ll04 = findSheet('ll04');

const near = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

const nearBox = (bbox: { x: number; y: number; w: number; h: number }, ref: { x: number; y: number; w: number; h: number }, tol: number, msg: string) => {
  near(bbox.x, ref.x, tol, `${msg} x`);
  near(bbox.y, ref.y, tol, `${msg} y`);
  near(bbox.w, ref.w, tol, `${msg} w`);
  near(bbox.h, ref.h, tol, `${msg} h`);
};

test('plain fixture: bbox near REF_LABEL, page is A4 at the origin', async () => {
  const pdf = await makeLabelPdf();
  const { bbox, page } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox!, REF_LABEL, 0.8, 'plain bbox');
  nearBox(page, { x: 0, y: 0, w: A4.w, h: A4.h }, 0.01, 'page');
});

for (const variant of ['whiteBackground', 'clipPath', 'invisibleText'] as const) {
  test(`${variant} adds no ink: bbox matches the plain fixture`, async () => {
    const plain = await makeLabelPdf();
    const withVariant = await makeLabelPdf({ [variant]: true });
    const plainResult = await measure(plain, 0, { createCanvas });
    const variantResult = await measure(withVariant, 0, { createCanvas });
    assert.ok(plainResult.bbox && variantResult.bbox);
    nearBox(variantResult.bbox!, plainResult.bbox!, 0.1, variant);
  });
}

test('integrated fixture: bbox covers >= 50% of the page and classifies as integrated', async () => {
  const pdf = await makeLabelPdf({ integrated: true });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  const bboxArea = bbox!.w * bbox!.h;
  assert.ok(bboxArea >= 0.5 * A4.w * A4.h, `bbox area ${bboxArea} < half of A4`);
  assert.equal(classify(bbox!, ll04), 'integrated');
});

test('mediaBoxOffset: page origin reported, bbox relative to it matches the plain fixture', async () => {
  const plain = await makeLabelPdf();
  const offset = await makeLabelPdf({ mediaBoxOffset: { x: 10, y: 20 } });
  const plainResult = await measure(plain, 0, { createCanvas });
  const offsetResult = await measure(offset, 0, { createCanvas });
  near(offsetResult.page.x, 10, 0.01, 'page.x');
  near(offsetResult.page.y, 20, 0.01, 'page.y');
  assert.ok(plainResult.bbox && offsetResult.bbox);
  nearBox(offsetResult.bbox!, plainResult.bbox!, 0.1, 'offset bbox');
});

test('pages: 3 measures each page independently', async () => {
  const pdf = await makeLabelPdf({ pages: 3 });
  const { bbox } = await measure(pdf, 2, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox!, REF_LABEL, 0.8, 'page 2 bbox');
});

test('label far from the origin is measured there, not at a hard-coded origin', async () => {
  // Same footprint as REF_LABEL (the fixture's text/barcode offsets are fixed mm distances
  // from the label's own corner, sized for that footprint) but moved well away from (0, 0),
  // so a hard-coded origin in measure() would show up as a large x/y error.
  const label = { x: 110, y: 130, w: 80.2, h: 125.2 };
  const pdf = await makeLabelPdf({ label });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);
  nearBox(bbox!, label, 0.8, 'far label bbox');
});

test('dpi: 36 still lands close to REF_LABEL', async () => {
  const pdf = await makeLabelPdf();
  const { bbox } = await measure(pdf, 0, { createCanvas, dpi: 36 });
  assert.ok(bbox);
  // Pixel-quantisation/anti-aliasing halo scales with pixel size (25.4/36 = 0.71mm/px here vs
  // 0.35mm/px at 72dpi), so the tolerance is wider than the 72dpi case; measured ~1.6-1.8mm off.
  nearBox(bbox!, REF_LABEL, 2, 'low-dpi bbox');
});

test('blank page: bbox is null', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]); // A4 in points
  const pdf = await doc.save({ useObjectStreams: false });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.equal(bbox, null);
});
