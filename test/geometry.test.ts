// Hand-computed expected values throughout. Nothing here is derived by calling place(),
// pdfTranslation() or labelBox() and trusting the result elsewhere: expected numbers come
// from arithmetic on sheets.json's own fields, done in the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, labelBox, place, pdfTranslation, PlacementError, type Box, type Sheet } from '../src/geometry.ts';
import { BUILTIN_SHEETS, findSheet } from '../src/sheets.ts';

const ll04 = findSheet('ll04', BUILTIN_SHEETS);
const lp4105 = findSheet('lp4-105', BUILTIN_SHEETS);
const l7168 = findSheet('l7168', BUILTIN_SHEETS);
const sixByFour = findSheet('6x4', BUILTIN_SHEETS);

const REF_LABEL: Box = { x: 15.1, y: 16.4, w: 80.2, h: 125.2 };
const CLOSE = 1e-9;
const close = (a: number, b: number, msg: string, tol = CLOSE) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} != ${b}`);

// --- labelBox: every position of every bundled sheet, computed by hand from the JSON fields ---

test('labelBox: ll04 (2x2, 99.1x139mm, marginLeft 4.65, marginTop 9.5, gapX 2.5, gapY 0)', () => {
  const { marginLeft, marginTop, gapX, gapY, label } = ll04;
  assert.deepEqual(labelBox(ll04, 1), { x: marginLeft, y: marginTop, w: label.w, h: label.h });
  assert.deepEqual(labelBox(ll04, 2), { x: marginLeft + label.w + gapX, y: marginTop, w: label.w, h: label.h });
  assert.deepEqual(labelBox(ll04, 3), { x: marginLeft, y: marginTop + label.h + gapY, w: label.w, h: label.h });
  assert.deepEqual(labelBox(ll04, 4), {
    x: marginLeft + label.w + gapX,
    y: marginTop + label.h + gapY,
    w: label.w,
    h: label.h,
  });
  // 4.65+99.1+2.5 = 106.25; 9.5+139+0 = 148.5
  assert.deepEqual(labelBox(ll04, 4), { x: 106.25, y: 148.5, w: label.w, h: label.h });
});

test('labelBox: lp4-105 (2x2, zero margins and gaps)', () => {
  const { label } = lp4105;
  assert.deepEqual(labelBox(lp4105, 1), { x: 0, y: 0, w: label.w, h: label.h });
  assert.deepEqual(labelBox(lp4105, 2), { x: label.w, y: 0, w: label.w, h: label.h });
  assert.deepEqual(labelBox(lp4105, 3), { x: 0, y: label.h, w: label.w, h: label.h });
  assert.deepEqual(labelBox(lp4105, 4), { x: label.w, y: label.h, w: label.w, h: label.h });
});

test('labelBox: l7168 (1x2, marginLeft 5.2, marginTop 5)', () => {
  const { marginLeft, marginTop, label } = l7168;
  assert.deepEqual(labelBox(l7168, 1), { x: marginLeft, y: marginTop, w: label.w, h: label.h });
  assert.deepEqual(labelBox(l7168, 2), { x: marginLeft, y: marginTop + label.h, w: label.w, h: label.h });
});

test('labelBox: 6x4 (single position, label == page)', () => {
  assert.deepEqual(labelBox(sixByFour, 1), { x: 0, y: 0, w: 101.6, h: 152.4 });
});

test('labelBox: RangeError outside 1..cols*rows', () => {
  assert.throws(() => labelBox(ll04, 0), RangeError);
  assert.throws(() => labelBox(ll04, 5), RangeError);
  assert.throws(() => labelBox(sixByFour, 2), RangeError);
});

// --- classify ---

test('classify: reference label is ok on all three A4 sheets and on 6x4', () => {
  assert.equal(classify(REF_LABEL, ll04), 'ok');
  assert.equal(classify(REF_LABEL, lp4105), 'ok');
  assert.equal(classify(REF_LABEL, l7168), 'ok');
  assert.equal(classify(REF_LABEL, sixByFour), 'ok');
});

test('classify: 100x140 on ll04 (0.9mm and 1.0mm over) is ok under the 1mm tolerance', () => {
  assert.equal(classify({ x: 0, y: 0, w: 100, h: 140 }, ll04), 'ok');
});

test('classify: 101x140 on ll04 is too-large', () => {
  assert.equal(classify({ x: 0, y: 0, w: 101, h: 140 }, ll04), 'too-large');
});

test('classify: 180x271 on A4 is integrated (>=50% of page area, checked before too-large)', () => {
  // 180*271 = 48780; 210*297 = 62370; 48780/62370 ~= 0.782 >= 0.5.
  assert.equal(classify({ x: 0, y: 0, w: 180, h: 271 }, ll04), 'integrated');
});

// --- place ---

test('place: centre on ll04 pos 2 with the reference bbox', () => {
  const target = labelBox(ll04, 2); // {x:106.25, y:9.5, w:99.1, h:139}
  const p = place(REF_LABEL, ll04, 2);
  const expectedDx = target.x + (target.w - REF_LABEL.w) / 2 - REF_LABEL.x; // 106.25+9.45-15.1 = 100.6
  const expectedDy = target.y + (target.h - REF_LABEL.h) / 2 - REF_LABEL.y; // 9.5+6.9-16.4 = 0.0
  close(p.dx, expectedDx, 'dx');
  close(p.dy, expectedDy, 'dy');
  close(p.dx, 100.6, 'dx literal');
  close(p.dy, 0.0, 'dy literal');
  assert.equal(p.rotate, 0);
  assert.equal(p.scale, 1);
  assert.deepEqual(p.warnings, []);
});

test('place: top-left on ll04 pos 2 with the reference bbox', () => {
  const target = labelBox(ll04, 2);
  const p = place(REF_LABEL, ll04, 2, { align: 'top-left' });
  close(p.dx, target.x - REF_LABEL.x, 'dx'); // 106.25-15.1 = 91.15
  close(p.dy, target.y - REF_LABEL.y, 'dy'); // 9.5-16.4 = -6.9
  close(p.dx, 91.15, 'dx literal');
  close(p.dy, -6.9, 'dy literal');
});

test('place: nudge is added last', () => {
  const target = labelBox(ll04, 2);
  const nudge = { x: 2, y: -3 };
  const p = place(REF_LABEL, ll04, 2, { nudge });
  const baseDx = target.x + (target.w - REF_LABEL.w) / 2 - REF_LABEL.x;
  const baseDy = target.y + (target.h - REF_LABEL.h) / 2 - REF_LABEL.y;
  close(p.dx, baseDx + nudge.x, 'dx');
  close(p.dy, baseDy + nudge.y, 'dy');
  // baseDx/baseDy are the centre case's 100.6/0.0, plus the nudge: 102.6, -3.0
  close(p.dx, 102.6, 'dx literal');
  close(p.dy, -3.0, 'dy literal');
});

test('place: rotation on 6x4 for a landscape bbox that fits only when turned', () => {
  const bbox: Box = { x: 10, y: 5, w: 125.2, h: 80.2 };
  const target = labelBox(sixByFour, 1); // {x:0,y:0,w:101.6,h:152.4}
  const p = place(bbox, sixByFour, 1);
  assert.equal(p.rotate, 90);
  assert.equal(p.scale, 1);
  assert.ok(p.warnings.some((w) => /rotat/i.test(w)));
  // Transposed target: {x:0, y:0, w:152.4, h:101.6}
  const transposed = { x: target.y, y: target.x, w: target.h, h: target.w };
  const expectedDx = transposed.x + (transposed.w - bbox.w) / 2 - bbox.x; // 0+13.6-10 = 3.6
  const expectedDy = transposed.y + (transposed.h - bbox.h) / 2 - bbox.y; // 0+10.7-5 = 5.7
  close(p.dx, expectedDx, 'dx');
  close(p.dy, expectedDy, 'dy');
  close(p.dx, 3.6, 'dx literal');
  close(p.dy, 5.7, 'dy literal');
});

test('place: rotated target box transposition handles asymmetric margins (1x1 sheet)', () => {
  // Hypothetical single-label sheet with an off-centre label: page 100x150, label 80x120,
  // marginLeft 5, marginTop 10 (so the label sits closer to the left edge than the right).
  const sheet: Sheet = {
    id: 'test-asym',
    name: 'Test asymmetric-margin sheet',
    aliases: [],
    page: { w: 100, h: 150 },
    cols: 1,
    rows: 1,
    label: { w: 80, h: 120 },
    marginLeft: 5,
    marginTop: 10,
    gapX: 0,
    gapY: 0,
    source: 'test fixture',
  };
  const target = labelBox(sheet, 1); // {x:5, y:10, w:80, h:120}
  // Displayed box (X,Y,w,h) under /Rotate 90 sits at x'=Y, y'=page.w-X-w in the drawn page:
  // x' = 10, y' = 100-5-80 = 15, w'=120, h'=80.
  const bbox: Box = { x: 4, y: 6, w: 110, h: 70 }; // fits target only when turned (110/70 vs 80/120)
  const p = place(bbox, sheet, 1);
  assert.equal(p.rotate, 90);
  // effectiveTarget = {x:10, y:15, w:120, h:80}
  // dx = 10 + (120-110)/2 - 4 = 10+5-4 = 11
  // dy = 15 + (80-70)/2 - 6 = 15+5-6 = 14
  close(p.dx, 11, 'dx');
  close(p.dy, 14, 'dy');
});

test('place: no rotation for the portrait reference bbox on 6x4', () => {
  const p = place(REF_LABEL, sixByFour, 1);
  assert.equal(p.rotate, 0);
  assert.ok(!p.warnings.some((w) => /rotat/i.test(w)));
});

test('place: never rotates on ll04 (cols*rows !== 1) - a landscape-only-fit bbox fails instead', () => {
  const bbox: Box = { x: 0, y: 0, w: 125.2, h: 80.2 };
  assert.throws(() => place(bbox, ll04, 1), PlacementError);
});

test('place: PlacementError for a 110x160 bbox on 6x4 (fits neither orientation)', () => {
  const bbox: Box = { x: 0, y: 0, w: 110, h: 160 };
  assert.throws(() => place(bbox, sixByFour, 1), PlacementError);
});

test('place: allowScale shrinks to fit and warns', () => {
  const bbox: Box = { x: 0, y: 0, w: 110, h: 160 };
  const expectedScale = Math.min(101.6 / 110, 152.4 / 160); // = 101.6/110
  const p = place(bbox, sixByFour, 1, { allowScale: true });
  close(p.scale, expectedScale, 'scale');
  assert.equal(p.rotate, 0);
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /scan/i);
  assert.match(p.warnings[0], /scale/i);
});

// --- pdfTranslation ---
// PT_PER_MM restated here (matches SPEC and geometry.ts's own constant) rather than imported,
// so the expected values are computed independently of the code under test.
const PT_PER_MM = 72 / 25.4;

test('pdfTranslation: scale 1, A4 -> A4, dx=dy=0 gives tx=ty=0', () => {
  const src: Box = { x: 0, y: 0, w: 210, h: 297 };
  const out = { w: 210, h: 297 };
  const { tx, ty } = pdfTranslation({ dx: 0, dy: 0, rotate: 0, scale: 1, warnings: [] }, src, out);
  close(tx, 0, 'tx');
  close(ty, 0, 'ty');
});

test('pdfTranslation: scale 1, MediaBox offset (src.x=10, src.y=20)', () => {
  const src: Box = { x: 10, y: 20, w: 210, h: 297 };
  const out = { w: 210, h: 297 };
  const dx = 5;
  const dy = 8;
  const { tx, ty } = pdfTranslation({ dx, dy, rotate: 0, scale: 1, warnings: [] }, src, out);
  // tx = pt(dx) - pt(src.x); ty = pt(out.h - src.h) - pt(dy) - pt(src.y)
  close(tx, (dx - src.x) * PT_PER_MM, 'tx');
  close(ty, ((out.h - src.h) - dy - src.y) * PT_PER_MM, 'ty');
});

test('pdfTranslation: A4 source onto a 6x4 page gives ty = pt(152.4 - 297) - pt(dy)', () => {
  const src: Box = { x: 0, y: 0, w: 210, h: 297 };
  const out = { w: 101.6, h: 152.4 };
  const dy = 2;
  const { tx, ty } = pdfTranslation({ dx: 0, dy, rotate: 0, scale: 1, warnings: [] }, src, out);
  close(tx, 0, 'tx');
  close(ty, (152.4 - 297) * PT_PER_MM - dy * PT_PER_MM, 'ty');
});

test('pdfTranslation: scale 0.5 against hand-computed points', () => {
  const src: Box = { x: 0, y: 0, w: 210, h: 297 };
  const out = { w: 101.6, h: 152.4 };
  const p = { dx: 3, dy: 4, rotate: 0 as const, scale: 0.5, warnings: [] };
  const { tx, ty } = pdfTranslation(p, src, out);
  // tx = pt(dx) - scale*pt(src.x) = pt(3) - 0.5*pt(0)
  close(tx, p.dx * PT_PER_MM - p.scale * src.x * PT_PER_MM, 'tx');
  // ty = pt(out.h - scale*(src.y+src.h)) - pt(dy) = pt(152.4 - 0.5*297) - pt(4)
  close(ty, (out.h - p.scale * (src.y + src.h)) * PT_PER_MM - p.dy * PT_PER_MM, 'ty');
  // Spelled out fully by hand: 152.4 - 148.5 = 3.9; (3.9 - 4) * PT_PER_MM = -0.1 * PT_PER_MM
  close(ty, -0.1 * PT_PER_MM, 'ty numeric');
});

test('pdfTranslation: scale 0.5 with a MediaBox-offset source, onto 6x4 (catches a dropped scale* on src.x/src.y)', () => {
  const src: Box = { x: 10, y: 20, w: 210, h: 297 };
  const out = { w: 101.6, h: 152.4 };
  const p = { dx: 3, dy: 4, rotate: 0 as const, scale: 0.5, warnings: [] };
  const { tx, ty } = pdfTranslation(p, src, out);
  // tx = pt(dx) - scale*pt(src.x) = pt(3) - 0.5*pt(10) = pt(3-5) = pt(-2)
  close(tx, -2 * PT_PER_MM, 'tx');
  // ty = pt(out.h - scale*(src.y+src.h)) - pt(dy) = pt(152.4 - 0.5*317) - pt(4) = pt(-10.1)
  close(ty, -10.1 * PT_PER_MM, 'ty');
});

// --- place + pdfTranslation round-trip ---
// Push a known source point through the actual PDF-space transform (place() then
// pdfTranslation()) and back to top-left mm, and check it lands where place()'s own centring
// arithmetic says it should. This exercises both functions together without trusting either
// one's internals in isolation.
const toPt = (v: number) => v * PT_PER_MM;
const toMm = (v: number) => v / PT_PER_MM;

test('place + pdfTranslation round-trip: REF_LABEL centred on ll04 pos 2', () => {
  const p = place(REF_LABEL, ll04, 2);
  const src: Box = { x: 0, y: 0, w: 210, h: 297 };
  const out = { w: 210, h: 297 };
  const { tx, ty } = pdfTranslation(p, src, out);

  // The bbox's own top-left corner, as a source content-stream point (pt, bottom-left origin).
  const X = toPt(REF_LABEL.x);
  const Y = toPt(297 - REF_LABEL.y);
  const xOut = p.scale * X + tx;
  const yOut = p.scale * Y + ty;
  const outXmm = toMm(xOut);
  const outYmm = out.h - toMm(yOut);

  const target = labelBox(ll04, 2);
  const expectedX = target.x + (target.w - REF_LABEL.w) / 2;
  const expectedY = target.y + (target.h - REF_LABEL.h) / 2;
  close(outXmm, expectedX, 'x', 1e-6);
  close(outYmm, expectedY, 'y', 1e-6);
});

test('place + pdfTranslation round-trip: allowScale on 6x4 with a 110x160 bbox', () => {
  const bbox: Box = { x: 0, y: 0, w: 110, h: 160 };
  const p = place(bbox, sixByFour, 1, { allowScale: true });
  const src: Box = { x: 0, y: 0, w: 210, h: 297 };
  const out = sixByFour.page;
  const { tx, ty } = pdfTranslation(p, src, out);

  const X = toPt(bbox.x);
  const Y = toPt(297 - bbox.y);
  const xOut = p.scale * X + tx;
  const yOut = p.scale * Y + ty;
  const outXmm = toMm(xOut);
  const outYmm = out.h - toMm(yOut);

  const target = labelBox(sixByFour, 1);
  const expectedX = target.x + (target.w - p.scale * bbox.w) / 2;
  const expectedY = target.y + (target.h - p.scale * bbox.h) / 2;
  close(outXmm, expectedX, 'x', 1e-6);
  close(outYmm, expectedY, 'y', 1e-6);
});
