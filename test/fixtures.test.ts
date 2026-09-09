import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from '@cantoo/pdf-lib';
import { makeLabelPdf } from './fixtures.ts';
import { pt } from '../src/geometry.ts';

test('fixture emits one A4 page per label with the requested rotation and MediaBox', async () => {
  const bytes = await makeLabelPdf({ pages: 3, rotate: 90, mediaBoxOffset: { x: 10, y: 20 } });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const page = doc.getPage(1);
  assert.equal(page.getRotation().angle, 90);
  const mb = page.getMediaBox();
  assert.deepEqual([mb.x, mb.y], [pt(10), pt(20)]);
  assert.ok(Math.abs(mb.width - pt(210)) < 1e-6 && Math.abs(mb.height - pt(297)) < 1e-6);
});

test('fixture variants produce distinct content streams', async () => {
  const a = await makeLabelPdf();
  const b = await makeLabelPdf({ whiteBackground: true, clipPath: true, invisibleText: true, integrated: true });
  assert.notEqual(a.length, b.length);
});
