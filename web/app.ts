// labelslot web UI. Plain DOM, no framework. Browser-only entry point (no node: imports).
// pdf.js needs a worker in the browser; set its URL before the first pipeline run() call.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

import { PDFDocument } from '@cantoo/pdf-lib';
import { labelBox, type Align, type Sheet } from '../src/geometry.ts';
import { BUILTIN_SHEETS, findSheet } from '../src/sheets.ts';
import { run, type PageReport } from '../src/pipeline.ts';
import { calibrationPage } from '../src/transform.ts';
import { nextUsed, firstUnused } from './used.ts';

function el<T extends Element = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as unknown as T;
}

// ---- tiny localStorage helpers: never let a private-mode/quota failure break the page ----
function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// ---- used-position persistence, per sheet id ----
type UsedSet = Set<number>;
const usedKey = (sheetId: string): string => `labelslot:used:${sheetId}`;

function loadUsed(sheetId: string): UsedSet {
  const raw = storageGet(usedKey(sheetId));
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((n): n is number => typeof n === 'number'));
  } catch {
    /* ignore corrupt storage */
  }
  return new Set();
}
function saveUsed(sheetId: string, used: UsedSet): void {
  storageSet(usedKey(sheetId), JSON.stringify([...used]));
}
const sheetCount = (sheet: Sheet): number => sheet.cols * sheet.rows;

// ---- state ----
let currentSheet: Sheet = BUILTIN_SHEETS[0];
let usedPositions: UsedSet = loadUsed(currentSheet.id);
let selectedPos = firstUnused(usedPositions, sheetCount(currentSheet));

type FileEntry = { name: string; bytes: Uint8Array; pages: number };
let files: FileEntry[] = [];

// ---- DOM refs ----
const sheetSelect = el<HTMLSelectElement>('sheet-select');
const gridSvg = el<SVGSVGElement>('grid-svg');
const usedList = el<HTMLDivElement>('used-list');
const resetSheetBtn = el<HTMLButtonElement>('reset-sheet');
const positionReadout = el<HTMLSpanElement>('position-readout');
const printerNameInput = el<HTMLInputElement>('printer-name');
const nudgeXInput = el<HTMLInputElement>('nudge-x');
const nudgeYInput = el<HTMLInputElement>('nudge-y');
const addPdfsBtn = el<HTMLButtonElement>('add-pdfs-btn');
const fileInput = el<HTMLInputElement>('file-input');
const fileListEl = el<HTMLUListElement>('file-list');
const clearFilesBtn = el<HTMLButtonElement>('clear-files-btn');
const statusNormal = el<HTMLDivElement>('status-normal');
const errorBox = el<HTMLDivElement>('error-box');
const reportLines = el<HTMLDivElement>('report-lines');
const printingReminderEl = el<HTMLSpanElement>('printing-reminder');
const downloadBtn = el<HTMLButtonElement>('download-btn');
const previewHint = el<HTMLDivElement>('preview-hint');
const previewPages = el<HTMLDivElement>('preview-pages');

// ---- sheet select + visual position grid ----
for (const s of BUILTIN_SHEETS) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = `${s.id} — ${s.name}`;
  sheetSelect.appendChild(opt);
}
sheetSelect.value = currentSheet.id;

const SVG_NS = 'http://www.w3.org/2000/svg';

function renderGrid(): void {
  gridSvg.textContent = '';
  gridSvg.setAttribute('viewBox', `0 0 ${currentSheet.page.w} ${currentSheet.page.h}`);
  const count = currentSheet.cols * currentSheet.rows;
  positionReadout.textContent = `${selectedPos} of ${count}`;

  const pageRect = document.createElementNS(SVG_NS, 'rect');
  pageRect.setAttribute('x', '0');
  pageRect.setAttribute('y', '0');
  pageRect.setAttribute('width', String(currentSheet.page.w));
  pageRect.setAttribute('height', String(currentSheet.page.h));
  pageRect.classList.add('sheet-page');
  gridSvg.appendChild(pageRect);

  for (let pos = 1; pos <= count; pos++) {
    const box = labelBox(currentSheet, pos);
    const isUsed = usedPositions.has(pos);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(box.x));
    rect.setAttribute('y', String(box.y));
    rect.setAttribute('width', String(box.w));
    rect.setAttribute('height', String(box.h));
    rect.classList.add('label-box');
    if (pos === selectedPos) rect.classList.add('selected');
    if (isUsed) rect.classList.add('used');
    rect.setAttribute('tabindex', '0');
    rect.setAttribute('role', 'button');
    rect.setAttribute('aria-label', `Position ${pos}`);
    const select = (): void => {
      selectedPos = pos;
      renderGrid();
    };
    rect.addEventListener('click', select);
    rect.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
    gridSvg.appendChild(rect);

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const numFontSize = Math.min(box.w, box.h) * 0.16;
    const numText = document.createElementNS(SVG_NS, 'text');
    numText.setAttribute('x', String(cx));
    numText.setAttribute('y', String(isUsed ? cy - box.h * 0.06 : cy));
    numText.setAttribute('font-size', String(numFontSize));
    numText.classList.add('label-box-number');
    numText.textContent = String(pos);
    gridSvg.appendChild(numText);

    if (isUsed) {
      const usedText = document.createElementNS(SVG_NS, 'text');
      usedText.setAttribute('x', String(cx));
      usedText.setAttribute('y', String(cy + box.h * 0.1));
      usedText.setAttribute('font-size', String(numFontSize * 0.55));
      usedText.classList.add('label-box-used-text');
      usedText.textContent = 'used';
      gridSvg.appendChild(usedText);
    }
  }
}

function renderUsedList(): void {
  const count = currentSheet.cols * currentSheet.rows;
  usedList.hidden = count === 1;
  resetSheetBtn.hidden = count === 1;
  usedList.textContent = '';
  for (let pos = 1; pos <= count; pos++) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = usedPositions.has(pos);
    cb.addEventListener('change', () => {
      if (cb.checked) usedPositions.add(pos);
      else usedPositions.delete(pos);
      saveUsed(currentSheet.id, usedPositions);
      renderGrid();
    });
    label.appendChild(cb);
    label.append(` Position ${pos} used`);
    usedList.appendChild(label);
  }
}

function printingReminder(sheet: Sheet): string {
  return sheet.cols * sheet.rows > 1
    ? 'Print at 100% / Actual size, not fit to page.'
    : "Turn off the driver's scale-to-fit-media option; the page is already the media size.";
}

function renderSheetUI(): void {
  renderGrid();
  renderUsedList();
  printingReminderEl.textContent = printingReminder(currentSheet);
}
renderSheetUI();

sheetSelect.addEventListener('change', () => {
  currentSheet = findSheet(sheetSelect.value);
  usedPositions = loadUsed(currentSheet.id);
  selectedPos = firstUnused(usedPositions, sheetCount(currentSheet));
  renderSheetUI();
});

resetSheetBtn.addEventListener('click', () => {
  usedPositions = new Set();
  saveUsed(currentSheet.id, usedPositions);
  selectedPos = firstUnused(usedPositions, sheetCount(currentSheet));
  renderSheetUI();
});

// ---- printer profile + nudge, persisted per printer name ----
const nudgeKey = (name: string): string => `labelslot:nudge:${name}`;
const LAST_PRINTER_KEY = 'labelslot:lastPrinter';

function loadNudge(name: string): { x: number; y: number } {
  const raw = storageGet(nudgeKey(name));
  if (raw) {
    try {
      const v = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
    } catch {
      /* ignore corrupt storage */
    }
  }
  return { x: 0, y: 0 };
}
function saveNudge(name: string): void {
  if (!name) return;
  storageSet(nudgeKey(name), JSON.stringify({ x: Number(nudgeXInput.value) || 0, y: Number(nudgeYInput.value) || 0 }));
}

const lastPrinter = storageGet(LAST_PRINTER_KEY) ?? '';
printerNameInput.value = lastPrinter;
if (lastPrinter) {
  const n = loadNudge(lastPrinter);
  nudgeXInput.value = String(n.x);
  nudgeYInput.value = String(n.y);
}

printerNameInput.addEventListener('input', () => {
  const name = printerNameInput.value.trim();
  storageSet(LAST_PRINTER_KEY, name);
  if (name) {
    const n = loadNudge(name);
    nudgeXInput.value = String(n.x);
    nudgeYInput.value = String(n.y);
  }
});
nudgeXInput.addEventListener('input', () => saveNudge(printerNameInput.value.trim()));
nudgeYInput.addEventListener('input', () => saveNudge(printerNameInput.value.trim()));

// ---- downloads: Blob + a temporary <a download> ----
function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

el<HTMLButtonElement>('calibrate-btn').addEventListener('click', () => {
  calibrationPage(currentSheet)
    .then((bytes) => downloadBytes(bytes, `labelslot-calibrate-${currentSheet.id}.pdf`))
    .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

// ---- input: "Add PDFs…" button + a window-wide drop target, list names + page counts ----
addPdfsBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) void addFiles(fileInput.files);
  fileInput.value = '';
});
clearFilesBtn.addEventListener('click', () => {
  files = [];
  renderFileList();
});

// A drag can enter/leave several elements as the pointer moves over the page, so a plain
// dragenter/dragleave pair flickers; count nesting depth instead and only clear at zero.
let dragDepth = 0;
const isFileDrag = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('drag-over');
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('drag-over');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drag-over');
  if (e.dataTransfer) void addFiles(e.dataTransfer.files);
});

async function addFiles(fileList: FileList): Promise<void> {
  for (const file of Array.from(fileList)) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError(`${file.name}: not a PDF, skipped.`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const doc = await PDFDocument.load(bytes.slice());
      files.push({ name: file.name, bytes, pages: doc.getPageCount() });
    } catch (err) {
      showError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  renderFileList();
}

function renderFileList(): void {
  fileListEl.textContent = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = `${f.name} (${f.pages} page${f.pages === 1 ? '' : 's'})`;
    fileListEl.appendChild(li);
  }
}

// ---- error / result display ----
function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
  statusNormal.hidden = true;
}
function hideError(): void {
  errorBox.hidden = true;
  errorBox.textContent = '';
  statusNormal.hidden = false;
}
function hideResult(): void {
  reportLines.textContent = '';
  downloadBtn.disabled = true;
  downloadBtn.onclick = null;
  previewPages.textContent = '';
  previewPages.hidden = true;
  previewHint.hidden = false;
}

function addReportLine(text: string, warn = false): void {
  const line = document.createElement('div');
  line.textContent = text;
  if (warn) line.classList.add('warn-line');
  reportLines.appendChild(line);
}

function showResult(pdf: Uint8Array, report: PageReport[], inputNames: string[], sheet: Sheet, pos: number): void {
  reportLines.textContent = '';
  for (const r of report) {
    const rotated = r.placement.rotate === 90 ? ' (rotated 90°)' : '';
    addReportLine(`${inputNames[r.input]} page ${r.page + 1} → page ${r.outputPage + 1} position ${r.position}${rotated}`);
  }
  const warnings = new Set<string>();
  for (const r of report) for (const w of r.placement.warnings) warnings.add(w);
  for (const w of warnings) addReportLine(`Warning: ${w}`, true);

  downloadBtn.disabled = false;
  downloadBtn.onclick = () => downloadBytes(pdf, `labelslot-${sheet.id}-pos${pos}.pdf`);
}

function markUsed(report: PageReport[]): void {
  const count = sheetCount(currentSheet);
  if (count === 1) return; // no "used" concept for single-label media
  usedPositions = nextUsed(report, count);
  saveUsed(currentSheet.id, usedPositions);
  selectedPos = firstUnused(usedPositions, count);
  renderSheetUI();
}

// ---- preview: render each output page and overlay the sheet's label boundaries ----
const PREVIEW_DPI = 96;

async function renderPreview(pdfBytes: Uint8Array, sheet: Sheet): Promise<void> {
  previewPages.textContent = '';
  const loadingTask = getDocument({ data: pdfBytes.slice() });
  const doc = await loadingTask.promise;
  const scale = PREVIEW_DPI / 72;
  const pxPerMm = PREVIEW_DPI / 25.4;
  const count = sheet.cols * sheet.rows;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const viewport = page.getViewport({ scale }); // honours the page's /Rotate by default
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ viewport, canvas }).promise;

        const wrap = document.createElement('div');
        wrap.className = 'preview-page';
        wrap.appendChild(canvas);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
        for (let pos = 1; pos <= count; pos++) {
          const box = labelBox(sheet, pos);
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(box.x * pxPerMm));
          rect.setAttribute('y', String(box.y * pxPerMm));
          rect.setAttribute('width', String(box.w * pxPerMm));
          rect.setAttribute('height', String(box.h * pxPerMm));
          rect.classList.add('overlay-box');
          svg.appendChild(rect);
        }
        wrap.appendChild(svg);
        previewPages.appendChild(wrap);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  previewHint.hidden = true;
  previewPages.hidden = false;
}

// ---- run ----
el<HTMLButtonElement>('run-btn').addEventListener('click', () => void doRun());

async function doRun(): Promise<void> {
  hideError();
  hideResult();
  if (files.length === 0) {
    showError('Choose at least one PDF first.');
    return;
  }

  const count = currentSheet.cols * currentSheet.rows;
  const pos = count === 1 ? 1 : selectedPos;
  const align = el<HTMLSelectElement>('align-select').value as Align;
  const assumeRaw = el<HTMLInputElement>('assume-pos').value.trim();
  const assumePosition = assumeRaw === '' ? undefined : Number(assumeRaw);
  const allowScale = el<HTMLInputElement>('allow-scale').checked;
  const nudge = { x: Number(nudgeXInput.value) || 0, y: Number(nudgeYInput.value) || 0 };

  try {
    const { pdf, report } = await run(
      files.map((f) => f.bytes),
      {
        sheet: currentSheet,
        pos,
        align,
        nudge,
        allowScale,
        assumePosition,
        createCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }),
      },
    );
    showResult(pdf, report, files.map((f) => f.name), currentSheet, pos);
    markUsed(report);
    await renderPreview(pdf, currentSheet);
    files = [];
    renderFileList();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}
