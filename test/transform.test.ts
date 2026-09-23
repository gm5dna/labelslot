import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { addOutputPage, calibrationPage, placePage } from '../src/transform.ts';
import { labelBox, mm, pdfTranslation, pt, place, type Box } from '../src/geometry.ts';
import { findSheet } from '../src/sheets.ts';
import { makeLabelPdf, REF_LABEL, A4 } from './fixtures.ts';

const ll04 = findSheet('ll04');
const sixByFour = findSheet('6x4');

/** Decode a page's /Contents (a single stream, or a PDFArray of streams concatenated with a
 * newline between parts, matching how PDFPageEmbedder joins them). */
function decodeContents(contents: PDFStream | PDFArray | undefined): Uint8Array {
  if (contents === undefined) return new Uint8Array(0);
  if (contents instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const stream = contents.lookup(i, PDFRawStream);
      parts.push(decodePDFRawStream(stream).decode());
      if (i < contents.size() - 1) parts.push(Uint8Array.of(0x0a));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
  }
  return decodePDFRawStream(contents as PDFRawStream).decode();
}

/** node.Contents() on a loaded page (PDFPageLeaf.Contents() is public but untyped on PDFPage). */
function pageContentsValue(page: any): PDFStream | PDFArray | undefined {
  return page.node.Contents();
}

function decodePageContent(page: unknown): string {
  return Buffer.from(decodeContents(pageContentsValue(page))).toString('latin1');
}

/** The single form XObject referenced from a page's /Resources /XObject dict. */
function soleXObject(page: any): { name: string; stream: PDFRawStream } {
  const resources = page.node.Resources() as PDFDict;
  const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const keys = xobjects.keys();
  assert.equal(keys.length, 1, 'exactly one XObject on the page');
  const name = keys[0].toString();
  const stream = xobjects.lookup(keys[0], PDFStream) as PDFRawStream;
  return { name, stream };
}

/** All cm matrices (as [a,b,c,d,e,f]) in a content stream, plus a check that the stream is
 * exactly `q <cm>* /Name Do Q` (pdf-lib's drawPage always emits translate, rotate, scale, skew
 * as four separate cm operators - identity ones included - then one Do). */
function parseDrawPageContent(content: string): { matrices: number[][]; xobjectName: string } {
  const trimmed = content.trim();
  const cmRe = /(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm/g;
  const matrices: number[][] = [];
  let m: RegExpExecArray | null;
  while ((m = cmRe.exec(trimmed))) matrices.push(m.slice(1, 7).map(Number));
  const stripped = trimmed.replace(/(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm/g, '').replace(/\s+/g, ' ').trim();
  const doMatch = stripped.match(/^q\s+\/(\S+)\s+Do\s+Q$/);
  return { matrices, xobjectName: doMatch ? doMatch[1] : '' };
}

/** Every text string drawn (StandardFonts encode as hex strings, WinAnsi = ASCII for the
 * printable range, so hex-decoding recovers plain text). */
function extractText(content: string): string {
  let out = '';
  for (const m of content.matchAll(/<([0-9A-Fa-f]+)>/g)) out += Buffer.from(m[1], 'hex').toString('latin1');
  return out;
}

/** Apply a PDF matrix [a b c d e f] to a point: (a*x+c*y+e, b*x+d*y+f). */
function applyMatrix(m: number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function hasImageXObject(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (dict?.lookup(PDFName.of('Subtype')) === PDFName.of('Image')) return true;
  }
  return false;
}

test('no-scaling proof: XObject is Subtype Form, Matrix identity, BBox = source MediaBox, and its decoded stream contains the source content stream verbatim', async () => {
  const srcBytes = await makeLabelPdf();
  // A second, independent load: reference content, untouched by embedPage's normalization.
  const srcRef = await PDFDocument.load(srcBytes);
  const refBox = srcRef.getPages()[0].getMediaBox();
  const refContent = decodeContents(pageContentsValue(srcRef.getPages()[0]));

  const src = await PDFDocument.load(srcBytes);
  const doc = await PDFDocument.create();
  const page = addOutputPage(doc, ll04, 0);
  const placement = place(REF_LABEL, ll04, 2);
  const srcBox: Box = { x: 0, y: 0, w: A4.w, h: A4.h };
  await placePage(page, src, 0, placement, srcBox);

  const bytes = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(bytes);
  const outPage = reloaded.getPages()[0];

  const { name, stream } = soleXObject(outPage);
  assert.equal(stream.dict.lookup(PDFName.of('Subtype')), PDFName.of('Form'));
  const matrix = stream.dict.lookup(PDFName.of('Matrix'), PDFArray);
  const matrixVals = [0, 1, 2, 3, 4, 5].map((i) => matrix.lookup(i, PDFNumber).asNumber());
  assert.deepEqual(matrixVals, [1, 0, 0, 1, 0, 0]);
  const bbox = stream.dict.lookup(PDFName.of('BBox'), PDFArray);
  const bboxVals = [0, 1, 2, 3].map((i) => bbox.lookup(i, PDFNumber).asNumber());
  assert.deepEqual(bboxVals, [refBox.x, refBox.y, refBox.x + refBox.width, refBox.y + refBox.height]);

  const xobjBytes = decodePDFRawStream(stream).decode();
  const idx = Buffer.from(xobjBytes).indexOf(Buffer.from(refContent));
  assert.ok(idx >= 0, 'source content stream occurs verbatim inside the XObject stream');
  const before = Buffer.from(xobjBytes.slice(0, idx)).toString('latin1').replace(/\s/g, '');
  const after = Buffer.from(xobjBytes.slice(idx + refContent.length)).toString('latin1').replace(/\s/g, '');
  assert.equal(before + after, 'qQ');

  const outContent = decodePageContent(outPage);
  const { matrices, xobjectName } = parseDrawPageContent(outContent);
  assert.equal(xobjectName, name.replace(/^\//, ''));
  assert.equal(matrices.length, 4);
  const [translate, rotate, scale, skew] = matrices;
  assert.deepEqual(rotate, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(skew, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual([scale[0], scale[3]], [1, 1]);
  assert.deepEqual([scale[1], scale[2], scale[4], scale[5]], [0, 0, 0, 0]);
  assert.deepEqual([translate[0], translate[1], translate[2], translate[3]], [1, 0, 0, 1]);

  const size = outPage.getSize();
  const expected = pdfTranslation(placement, srcBox, { w: mm(size.width), h: mm(size.height) });
  assert.ok(Math.abs(translate[4] - expected.tx) < 1e-6);
  assert.ok(Math.abs(translate[5] - expected.ty) < 1e-6);

  assert.equal(hasImageXObject(reloaded), false);
});

// Golden bbox check (belt and braces, not the proof that matters - see the test above).
// measure() is not implemented on this branch (another slice implements it in parallel).
// Golden test: belt and braces alongside the byte-level proof above. Re-measures the output
// with the real measurement code and checks the ink lies inside the target label. Includes the
// offset-MediaBox source, which is the case pdf-lib's default embed matrix got wrong.
for (const mediaBoxOffset of [{ x: 0, y: 0 }, { x: 10, y: 20 }]) {
  test(`golden bbox: placed ink lies within labelBox(ll04, 2) (MediaBox origin ${mediaBoxOffset.x},${mediaBoxOffset.y})`, async () => {
    const { measure } = await import('../src/measure.ts');
    const { createCanvas } = await import('@napi-rs/canvas');
    const srcBytes = await makeLabelPdf({ mediaBoxOffset });
    const measured = await measure(srcBytes, 0, { createCanvas });
    assert.ok(measured.bbox);
    const out = await PDFDocument.create();
    const page = addOutputPage(out, ll04, 0);
    const placement = place(measured.bbox, ll04, 2);
    await placePage(page, await PDFDocument.load(srcBytes), 0, placement, measured.page);
    const result = await measure(await out.save(), 0, { createCanvas });
    assert.ok(result.bbox);
    const target = labelBox(ll04, 2);
    const got = result.bbox;
    assert.ok(got.x >= target.x - 1 && got.y >= target.y - 1, `top-left ${got.x},${got.y} outside ${target.x},${target.y}`);
    assert.ok(got.x + got.w <= target.x + target.w + 1 && got.y + got.h <= target.y + target.h + 1, 'bottom-right outside label');
    // Centred: the placed ink's centre is within one pixel (0.35 mm) of the label's centre.
    assert.ok(Math.abs(got.x + got.w / 2 - (target.x + target.w / 2)) < 0.5, 'not centred horizontally');
    assert.ok(Math.abs(got.y + got.h / 2 - (target.y + target.h / 2)) < 0.5, 'not centred vertically');
  });
}

test('MediaBox offset: cm translation and BBox account for the source MediaBox origin', async () => {
  const srcBytes = await makeLabelPdf({ mediaBoxOffset: { x: 10, y: 20 } });
  const srcRef = await PDFDocument.load(srcBytes);
  const refBox = srcRef.getPages()[0].getMediaBox();

  const src = await PDFDocument.load(srcBytes);
  const doc = await PDFDocument.create();
  const page = addOutputPage(doc, ll04, 0);
  const placement = place(REF_LABEL, ll04, 2);
  const srcBox: Box = { x: 10, y: 20, w: A4.w, h: A4.h };
  await placePage(page, src, 0, placement, srcBox);

  const bytes = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(bytes);
  const outPage = reloaded.getPages()[0];

  const { stream } = soleXObject(outPage);
  const matrix = stream.dict.lookup(PDFName.of('Matrix'), PDFArray);
  const matrixVals = [0, 1, 2, 3, 4, 5].map((i) => matrix.lookup(i, PDFNumber).asNumber());
  assert.deepEqual(matrixVals, [1, 0, 0, 1, 0, 0]);
  const bbox = stream.dict.lookup(PDFName.of('BBox'), PDFArray);
  const bboxVals = [0, 1, 2, 3].map((i) => bbox.lookup(i, PDFNumber).asNumber());
  assert.deepEqual(bboxVals, [refBox.x, refBox.y, refBox.x + refBox.width, refBox.y + refBox.height]);

  const outContent = decodePageContent(outPage);
  const { matrices } = parseDrawPageContent(outContent);
  const [translate] = matrices;

  const size = outPage.getSize();
  const expected = pdfTranslation(placement, srcBox, { w: mm(size.width), h: mm(size.height) });
  assert.ok(Math.abs(translate[4] - expected.tx) < 1e-6);
  assert.ok(Math.abs(translate[5] - expected.ty) < 1e-6);

  // Independent of pdfTranslation: the fixture's own drawn coordinate for the label's
  // bottom-left corner, run through the actual Matrix and then the actual cm's, should land
  // on the centred position within labelBox(ll04, 2) - by hand, not via geometry.ts.
  const srcPointX = pt(10) + pt(REF_LABEL.x);
  const srcPointY = pt(20) + pt(A4.h) - pt(REF_LABEL.y + REF_LABEL.h);
  let p = applyMatrix(matrixVals, srcPointX, srcPointY);
  for (const m of [...matrices].reverse()) p = applyMatrix(m, p.x, p.y);
  const target = labelBox(ll04, 2);
  assert.ok(Math.abs(p.x - pt(target.x + (99.1 - 80.2) / 2)) < 1e-6);
  assert.ok(Math.abs(p.y - pt(A4.h - (target.y + (139 - 125.2) / 2 + 125.2))) < 1e-6);
});

test('addOutputPage: thermal rotation', async () => {
  const doc = await PDFDocument.create();

  const rotated = addOutputPage(doc, sixByFour, 90);
  const rSize = rotated.getSize();
  assert.ok(Math.abs(rSize.width - 432) < 1e-6);
  assert.ok(Math.abs(rSize.height - 288) < 1e-6);
  assert.equal(rotated.getRotation().angle, 90);

  const upright = addOutputPage(doc, sixByFour, 0);
  const uSize = upright.getSize();
  assert.ok(Math.abs(uSize.width - 288) < 1e-6);
  assert.ok(Math.abs(uSize.height - 432) < 1e-6);
  assert.equal(upright.getRotation().angle, 0);
});

test('scale path: --allow-scale draws the XObject with xScale/yScale = placement.scale', async () => {
  const srcBytes = await makeLabelPdf();
  const src = await PDFDocument.load(srcBytes);
  const doc = await PDFDocument.create();
  const page = addOutputPage(doc, sixByFour, 0);
  const placement = place({ x: 0, y: 0, w: 110, h: 160 }, sixByFour, 1, { allowScale: true });
  assert.ok(placement.scale < 1);
  const srcBox: Box = { x: 0, y: 0, w: A4.w, h: A4.h };
  await placePage(page, src, 0, placement, srcBox);

  const bytes = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(bytes);
  const outPage = reloaded.getPages()[0];
  const outContent = decodePageContent(outPage);
  const { matrices } = parseDrawPageContent(outContent);
  assert.equal(matrices.length, 4);
  const [translate, rotate, scale, skew] = matrices;
  assert.deepEqual(rotate, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(skew, [1, 0, 0, 1, 0, 0]);
  assert.ok(Math.abs(scale[0] - placement.scale) < 1e-6);
  assert.ok(Math.abs(scale[3] - placement.scale) < 1e-6);
  assert.deepEqual([scale[1], scale[2], scale[4], scale[5]], [0, 0, 0, 0]);

  const size = outPage.getSize();
  const expected = pdfTranslation(placement, srcBox, { w: mm(size.width), h: mm(size.height) });
  assert.ok(Math.abs(translate[4] - expected.tx) < 1e-6);
  assert.ok(Math.abs(translate[5] - expected.ty) < 1e-6);
});

test('calibrationPage: one A4 page with crosshairs at every position and a nudge instruction', async () => {
  const bytes = await calibrationPage(ll04);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  assert.equal(pages.length, 1);
  const size = pages[0].getSize();
  assert.ok(Math.abs(size.width - pt(A4.w)) < 1e-6);
  assert.ok(Math.abs(size.height - pt(A4.h)) < 1e-6);

  const content = decodePageContent(pages[0]);
  // 4 corners x (2 crosshair hairlines + 2 arms x 11 rule ticks) x 4 positions on ll04.
  const lCount = (content.match(/(?:^|\s)l\s/g) ?? []).length;
  assert.ok(lCount >= 384, `expected at least 384 l operators, got ${lCount}`);
  const text = extractText(content);
  assert.ok(text.includes('--nudge'));
  assert.ok(text.includes('negative nudge'));
});

test('multi-page: two source pages placed on the same output page embed as two distinct XObjects', async () => {
  const srcBytes = await makeLabelPdf({ pages: 2 });
  const srcRef = await PDFDocument.load(srcBytes);
  const refContents = [0, 1].map((i) => decodeContents(pageContentsValue(srcRef.getPages()[i])));

  const src = await PDFDocument.load(srcBytes);
  const doc = await PDFDocument.create();
  const page = addOutputPage(doc, ll04, 0);
  const p1 = place(REF_LABEL, ll04, 1);
  const p2 = place(REF_LABEL, ll04, 2);
  const srcBox: Box = { x: 0, y: 0, w: A4.w, h: A4.h };
  await placePage(page, src, 0, p1, srcBox);
  await placePage(page, src, 1, p2, srcBox);

  const bytes = await doc.save({ useObjectStreams: false });
  const reloaded = await PDFDocument.load(bytes);
  const outPage = reloaded.getPages()[0];
  const resources = (outPage as unknown as { node: { Resources(): PDFDict } }).node.Resources();
  const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const keys = xobjects.keys();
  assert.equal(keys.length, 2);

  const streams = keys.map((k) => decodePDFRawStream(xobjects.lookup(k, PDFStream) as PDFRawStream).decode());
  const matchedRefs = new Set<number>();
  for (const s of streams) {
    const buf = Buffer.from(s);
    const matches = refContents
      .map((ref, i) => ({ i, idx: buf.indexOf(Buffer.from(ref)) }))
      .filter((r) => r.idx >= 0);
    assert.equal(matches.length, 1, 'each XObject stream contains exactly one source page verbatim');
    matchedRefs.add(matches[0].i);
  }
  assert.deepEqual(matchedRefs, new Set([0, 1]));
});
