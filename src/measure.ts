// Measure the drawn label on a page by rendering it to a low-resolution bitmap with pdf.js and
// taking the bounds of the non-white pixels. The bitmap is discarded; nothing rasterised ever
// reaches the output. Browser-safe: the caller supplies createCanvas (DOM or @napi-rs/canvas).
import type { Box } from './geometry.ts';

/** Minimal canvas surface pdf.js can render into and we can read pixels from. */
export type Canvas = {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
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

/** Render page `pageIndex` (0-based) of `pdf` with rotation 0 and return the ink bounds. */
export function measure(pdf: Uint8Array, pageIndex: number, opts: MeasureOptions): Promise<Measured> {
  throw new Error('not implemented');
}
