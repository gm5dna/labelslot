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
function storageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
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

/** Bumped by hideResult(). doRun captures the value before awaiting run() and discards the
 * result if it no longer matches - a setting changed mid-run (which calls hideResult()) must
 * not let a stale result (and its used-position bookkeeping) land after the fact. */
let resultGeneration = 0;

// ---- DOM refs ----
const sheetSelect = el<HTMLSelectElement>('sheet-select');
const gridSvg = el<SVGSVGElement>('grid-svg');
const usedList = el<HTMLDivElement>('used-list');
const resetSheetBtn = el<HTMLButtonElement>('reset-sheet');
const positionReadout = el<HTMLSpanElement>('position-readout');
const printerNameInput = el<HTMLInputElement>('printer-name');
const printerNamesDatalist = el<HTMLDataListElement>('printer-names');
const nudgeXInput = el<HTMLInputElement>('nudge-x');
const nudgeYInput = el<HTMLInputElement>('nudge-y');
const alignSelect = el<HTMLSelectElement>('align-select');
const assumePosInput = el<HTMLInputElement>('assume-pos');
const allowScaleCheckbox = el<HTMLInputElement>('allow-scale');
const allowScaleHint = el<HTMLSpanElement>('allow-scale-hint');
const addPdfsBtn = el<HTMLButtonElement>('add-pdfs-btn');
const fileInput = el<HTMLInputElement>('file-input');
const fileListEl = el<HTMLUListElement>('file-list');
const clearFilesBtn = el<HTMLButtonElement>('clear-files-btn');
const errorBox = el<HTMLDivElement>('error-box');
const warningBox = el<HTMLDivElement>('warning-box');
const reportLines = el<HTMLDivElement>('report-lines');
const printingReminderEl = el<HTMLSpanElement>('printing-reminder');
const runBtn = el<HTMLButtonElement>('run-btn');
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

/** A diagonal-hatch pattern (plus a solid backing rect) so a used position reads as visually
 * distinct from an unused one, not just a slightly duller fill. */
function appendHatchPattern(): void {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', 'used-hatch');
  pattern.setAttribute('width', '4');
  pattern.setAttribute('height', '4');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', 'rotate(45)');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '4');
  bg.setAttribute('height', '4');
  bg.classList.add('used-hatch-bg');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '0');
  line.setAttribute('x2', '0');
  line.setAttribute('y2', '4');
  line.classList.add('used-hatch-line');
  pattern.appendChild(bg);
  pattern.appendChild(line);
  defs.appendChild(pattern);
  gridSvg.appendChild(defs);
}

function renderGrid(): void {
  gridSvg.textContent = '';
  appendHatchPattern();
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
    rect.setAttribute('aria-label', isUsed ? `Position ${pos}, used` : `Position ${pos}`);
    rect.setAttribute('aria-pressed', String(pos === selectedPos));
    const select = (): void => {
      selectedPos = pos;
      hideResult();
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
  usedList.style.gridTemplateColumns = `repeat(${currentSheet.cols}, 1fr)`;
  for (let pos = 1; pos <= count; pos++) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = usedPositions.has(pos);
    cb.addEventListener('change', () => {
      if (cb.checked) usedPositions.add(pos);
      else usedPositions.delete(pos);
      saveUsed(currentSheet.id, usedPositions);
      hideResult();
      renderGrid();
    });
    label.appendChild(cb);
    label.append(` ${pos} used`);
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
  assumePosInput.max = String(sheetCount(currentSheet));
}
renderSheetUI();

sheetSelect.addEventListener('change', () => {
  currentSheet = findSheet(sheetSelect.value);
  usedPositions = loadUsed(currentSheet.id);
  selectedPos = firstUnused(usedPositions, sheetCount(currentSheet));
  hideResult();
  renderSheetUI();
});

resetSheetBtn.addEventListener('click', () => {
  usedPositions = new Set();
  saveUsed(currentSheet.id, usedPositions);
  selectedPos = firstUnused(usedPositions, sheetCount(currentSheet));
  hideResult();
  renderSheetUI();
});

// ---- printer profile + nudge, persisted per printer name ----
const nudgeKey = (name: string): string => `labelslot:nudge:${name}`;
const LAST_PRINTER_KEY = 'labelslot:lastPrinter';
const NUDGE_KEY_PREFIX = 'labelslot:nudge:';

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
  renderPrinterDatalist();
}

function renderPrinterDatalist(): void {
  printerNamesDatalist.textContent = '';
  for (const key of storageKeys()) {
    if (!key.startsWith(NUDGE_KEY_PREFIX)) continue;
    const opt = document.createElement('option');
    opt.value = key.slice(NUDGE_KEY_PREFIX.length);
    printerNamesDatalist.appendChild(opt);
  }
}
renderPrinterDatalist();

const lastPrinter = storageGet(LAST_PRINTER_KEY) ?? '';
printerNameInput.value = lastPrinter;
if (lastPrinter) {
  const n = loadNudge(lastPrinter);
  nudgeXInput.value = String(n.x);
  nudgeYInput.value = String(n.y);
}

// Loaded on 'change' (blur/Enter/pick from the datalist), not 'input': typing must not reset
// the nudge fields on every keystroke, nor save a half-typed name as the last printer.
printerNameInput.addEventListener('change', () => {
  const name = printerNameInput.value.trim();
  storageSet(LAST_PRINTER_KEY, name);
  if (name) {
    if (storageGet(nudgeKey(name)) === null) {
      // No saved nudge for this printer yet: keep the current X/Y and save them under the new
      // name, rather than resetting the fields to 0/0.
      saveNudge(name);
    } else {
      const n = loadNudge(name);
      nudgeXInput.value = String(n.x);
      nudgeYInput.value = String(n.y);
    }
  }
  hideResult();
});
nudgeXInput.addEventListener('input', () => {
  saveNudge(printerNameInput.value.trim());
  hideResult();
});
nudgeYInput.addEventListener('input', () => {
  saveNudge(printerNameInput.value.trim());
  hideResult();
});

alignSelect.addEventListener('change', hideResult);
assumePosInput.addEventListener('input', hideResult);
allowScaleCheckbox.addEventListener('change', () => {
  allowScaleHint.hidden = !allowScaleCheckbox.checked;
  hideResult();
});

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
  // Revoked later, not synchronously: revoking immediately can race the browser's own read of
  // the blob URL for the download, especially for larger PDFs.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  hideResult();
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
  if (!isFileDrag(e)) return; // let text dropped into an input (e.g. printer name) behave normally
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drag-over');
  if (e.dataTransfer) void addFiles(e.dataTransfer.files);
});

async function addFiles(fileList: FileList): Promise<void> {
  const errors: string[] = [];
  let added = false;
  for (const file of Array.from(fileList)) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      errors.push(`${file.name}: not a PDF, skipped.`);
      continue;
    }
    if (files.some((f) => f.name === file.name && f.bytes.length === file.size)) {
      errors.push(`${file.name}: already in the list, skipped.`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const doc = await PDFDocument.load(bytes.slice());
      files.push({ name: file.name, bytes, pages: doc.getPageCount() });
      added = true;
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) showError(errors.join('\n'));
  else hideError();
  if (added) hideResult();
  renderFileList();
}

function removeFile(index: number): void {
  files.splice(index, 1);
  hideResult();
  renderFileList();
}

function renderFileList(): void {
  fileListEl.textContent = '';
  clearFilesBtn.hidden = files.length === 0;
  if (files.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No files yet. Drop PDFs anywhere in this window, or use Add PDFs…';
    fileListEl.appendChild(li);
    return;
  }
  files.forEach((f, index) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${f.name} (${f.pages} page${f.pages === 1 ? '' : 's'})`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-remove-btn';
    removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeFile(index));
    li.appendChild(label);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });
}
renderFileList();

// ---- CLI-to-UI wording: pipeline/geometry error messages are written for the CLI ----
/** input N, page M -> <file name>, page M, using the file list from the run that failed. */
function mapInputPrefix(message: string, fileNames: string[]): string {
  return message.replace(/^input (\d+), page (\d+)/, (whole, n: string, p: string) => {
    const name = fileNames[Number(n) - 1];
    return name ? `${name}, page ${p}` : whole;
  });
}

/**
 * CLI flag wording -> UI wording, for the two flags the UI actually surfaces as options
 * elsewhere on the page. Run before mapInputPrefix so a file name that happens to contain
 * "--" is never mistaken for a flag.
 */
function mapCliWording(message: string, fileNames: string[]): string {
  let msg = message;
  msg = msg.replace(/--assume-position(?:\s+N)?/g, 'the "Assume position" option');
  msg = msg.replace(/--allow-scale/g, '"Allow scale"');
  msg = mapInputPrefix(msg, fileNames);
  return msg;
}

// ---- error / result display ----
function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
}
function hideError(): void {
  errorBox.hidden = true;
  errorBox.textContent = '';
}
function hideResult(): void {
  resultGeneration++;
  reportLines.textContent = '';
  warningBox.hidden = true;
  warningBox.textContent = '';
  downloadBtn.disabled = true;
  downloadBtn.onclick = null;
  downloadBtn.classList.remove('btn-primary');
  runBtn.classList.add('btn-primary');
  previewPages.textContent = '';
  previewPages.hidden = true;
  previewHint.hidden = false;
}

function addReportLine(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  reportLines.appendChild(line);
}

function showWarnings(warnings: string[]): void {
  warningBox.textContent = '';
  if (warnings.length === 0) {
    warningBox.hidden = true;
    return;
  }
  for (const w of warnings) {
    const line = document.createElement('div');
    line.textContent = `Warning: ${w}`;
    warningBox.appendChild(line);
  }
  warningBox.hidden = false;
}

/**
 * Marks `report`'s positions used, starting from the used set captured when the run started
 * (`before`), not whatever usedPositions has become since (e.g. a second download of the same
 * result). Called from the Download button, once per result - see showResult. Takes the run's
 * own sheet rather than reading currentSheet, in case the displayed sheet has moved on.
 */
function markUsedFromRun(sheet: Sheet, report: PageReport[], before: UsedSet): void {
  const count = sheetCount(sheet);
  if (count === 1) return; // no "used" concept for single-label media
  usedPositions = nextUsed(before, report, count);
  saveUsed(sheet.id, usedPositions);
  selectedPos = firstUnused(usedPositions, count);
  renderSheetUI();
}

function showResult(
  pdf: Uint8Array,
  report: PageReport[],
  inputNames: string[],
  sheet: Sheet,
  pos: number,
  usedBeforeRun: UsedSet,
): void {
  reportLines.textContent = '';
  for (const r of report) {
    const rotated = r.placement.rotate === 90 ? ' (rotated 90°)' : '';
    addReportLine(`${inputNames[r.input]} page ${r.page + 1} → page ${r.outputPage + 1} position ${r.position}${rotated}`);
  }
  const warnings = new Set<string>();
  for (const r of report) for (const w of r.placement.warnings) warnings.add(w);
  showWarnings([...warnings]);

  downloadBtn.disabled = false;
  downloadBtn.classList.add('btn-primary');
  runBtn.classList.remove('btn-primary');

  let applied = false;
  downloadBtn.onclick = () => {
    const filename = `labelslot-${sheet.id}-pos${pos}.pdf`;
    downloadBytes(pdf, filename);
    if (!applied) {
      applied = true;
      markUsedFromRun(sheet, report, usedBeforeRun);
      // Clear the file list only now, not when the PDF was made: before Download, the files
      // stay in place so a failed/retried download can be tried again without re-adding them.
      // Clearing after means adding the next label can't accidentally reprint this one.
      files = [];
      renderFileList();
      addReportLine(`Saved ${filename}.`);
      addReportLine('Files cleared after download.');
    }
  };
}

// ---- preview: render each output page and overlay the sheet's label boundaries ----
const PREVIEW_DPI = 96;

async function renderPreview(pdfBytes: Uint8Array, sheet: Sheet): Promise<void> {
  previewPages.textContent = '';
  const loadingTask = getDocument({ data: pdfBytes.slice() });
  const doc = await loadingTask.promise;
  const cssScale = PREVIEW_DPI / 72;
  const dpr = window.devicePixelRatio || 1;
  const pxPerMm = PREVIEW_DPI / 25.4; // CSS px per mm - the overlay SVG's viewBox is in CSS px
  const count = sheet.cols * sheet.rows;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        // Two viewports: render at device resolution for a crisp canvas, but size the canvas
        // (and the overlay's viewBox) in CSS pixels so the mm->px overlay maths is unaffected
        // by devicePixelRatio.
        const cssViewport = page.getViewport({ scale: cssScale }); // honours the page's /Rotate
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        const cssW = Math.ceil(cssViewport.width);
        const cssH = Math.ceil(cssViewport.height);

        // Only width is pinned; height is left to the CSS default of 'auto' so the browser
        // scales it to match the canvas's intrinsic (bitmap) aspect ratio. A pinned height
        // here would distort the image (and desync the overlay) once max-width:100% shrinks
        // the displayed width below cssW, e.g. when the preview pane is narrower than 794px.
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${cssW}px`;
        await page.render({ viewport: renderViewport, canvas }).promise;

        const wrap = document.createElement('div');
        wrap.className = 'preview-page';
        wrap.appendChild(canvas);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`);
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
runBtn.addEventListener('click', () => void doRun());

async function doRun(): Promise<void> {
  hideError();
  hideResult();
  const runGeneration = resultGeneration;
  if (files.length === 0) {
    showError('Choose at least one PDF first.');
    return;
  }

  const count = sheetCount(currentSheet);
  const pos = count === 1 ? 1 : selectedPos;
  const align = alignSelect.value as Align;
  const assumeRaw = assumePosInput.value.trim();
  const assumePosition = assumeRaw === '' ? undefined : Number(assumeRaw);
  const allowScale = allowScaleCheckbox.checked;
  const nudge = { x: Number(nudgeXInput.value) || 0, y: Number(nudgeYInput.value) || 0 };

  const usedBeforeRun = new Set(usedPositions);
  const runSheet = currentSheet;
  const inputNames = files.map((f) => f.name);
  const runBtnLabel = runBtn.textContent;
  runBtn.disabled = true;
  runBtn.textContent = 'Working…';
  try {
    const { pdf, report } = await run(
      files.map((f) => f.bytes),
      {
        sheet: runSheet,
        pos,
        skip: count === 1 ? [] : [...usedPositions],
        align,
        nudge,
        allowScale,
        assumePosition,
        createCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }),
      },
    );
    if (runGeneration !== resultGeneration) return; // a setting changed mid-run; discard
    showResult(pdf, report, inputNames, runSheet, pos, usedBeforeRun);
    await renderPreview(pdf, runSheet);
  } catch (err) {
    if (runGeneration !== resultGeneration) return; // a setting changed mid-run; discard
    showError(mapCliWording(err instanceof Error ? err.message : String(err), inputNames));
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = runBtnLabel;
  }
}
