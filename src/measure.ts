// Measure the drawn label on a page by rendering it to a low-resolution bitmap with pdf.js and
// taking the bounds of the non-white pixels. The bitmap is discarded; nothing rasterised ever
// reaches the output. Browser-safe: the caller supplies createCanvas (DOM or @napi-rs/canvas).
//
// Import note: the legacy build (pdfjs-dist/legacy/build/pdf.mjs) works both under Node's test
// runner and when bundled for the browser by esbuild, so it is used for both. Node needs no
// worker; the web build must set GlobalWorkerOptions.workerSrc before calling measure().
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mm, type Box } from './geometry.ts';

/** Minimal 2d context surface this module needs: read the rendered pixels back. */
export type Canvas2DContext = {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
};
/** Minimal canvas surface pdf.js can render into and we can read pixels from. */
export type Canvas = {
  width: number;
  height: number;
  getContext(type: '2d'): Canvas2DContext | null;
};
export type CreateCanvas = (width: number, height: number) => Canvas;

export type MeasureOptions = {
  createCanvas: CreateCanvas;
  /** Render resolution. Default 72: one pixel is 0.35 mm, comparable to sheet tolerance. */
  dpi?: number;
  /** A pixel counts as ink when any RGB channel is below this. Default 250 (anti-aliased edges count). */
  threshold?: number;
};

export type Measured = {
  /** Bounds of the ink in mm, top-left origin, relative to the MediaBox origin. null when the page is blank. */
  bbox: Box | null;
  /** The page MediaBox in mm: x/y are its origin (usually 0/0), w/h its size. */
  page: Box;
};

/** Render page `pageIndex` (0-based) of an already-loaded pdf.js document and return the ink bounds. */
export async function measurePage(doc: PDFDocumentProxy, pageIndex: number, opts: MeasureOptions): Promise<Measured> {
  const { createCanvas, dpi = 72, threshold = 250 } = opts;
  const page = await doc.getPage(pageIndex + 1); // pdf.js pages are 1-based
  try {
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale, rotation: 0 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('measure: createCanvas returned a canvas with no 2d context');
    // Pass `canvas`, not `canvasContext`: pdf.js's own beginDrawing() fills it white via
    // canvasContext.canvas before drawing, and when `canvas` is given it fetches the context
    // itself (ignoring `canvasContext`) via canvas.getContext('2d', ...), so there is no need
    // to pre-fill or pass our own context in. pdf.js's types declare `canvas` as a DOM
    // HTMLCanvasElement; a Node canvas (@napi-rs/canvas) is a structural match at runtime but
    // not nominally, hence the cast.
    await page.render({ viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;

    const { data: pixels } = ctx.getImageData(0, 0, width, height);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i] < threshold || pixels[i + 1] < threshold || pixels[i + 2] < threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // px -> mm at this dpi.
    const k = 25.4 / dpi;
    const bbox: Box | null =
      maxX === -Infinity
        ? null
        : { x: minX * k, y: minY * k, w: (maxX - minX + 1) * k, h: (maxY - minY + 1) * k };

    // page.view is the MediaBox (CropBox ∩ MediaBox) in points: [x0, y0, x1, y1]. The
    // pipeline refuses pages whose CropBox differs from the MediaBox, so this is the
    // MediaBox origin and size.
    const [x0, y0, x1, y1] = page.view;
    const pageBox: Box = { x: mm(x0), y: mm(y0), w: mm(x1 - x0), h: mm(y1 - y0) };

    return { bbox, page: pageBox };
  } finally {
    page.cleanup();
  }
}

/** Render page `pageIndex` (0-based) of `pdf` with rotation 0 and return the ink bounds. */
export async function measure(pdf: Uint8Array, pageIndex: number, opts: MeasureOptions): Promise<Measured> {
  // new Uint8Array(pdf) both copies (pdf.js transfers/detaches the buffer it's given, so the
  // caller's bytes must not be handed over directly) and normalises a Node Buffer (a Uint8Array
  // subclass) to a plain Uint8Array, which pdf.js otherwise refuses with "Please provide binary
  // data as Uint8Array, rather than Buffer".
  const data = new Uint8Array(pdf);
  const loadingTask = getDocument({ data });
  try {
    const doc = await loadingTask.promise;
    return await measurePage(doc, pageIndex, opts);
  } finally {
    await loadingTask.destroy();
  }
}
