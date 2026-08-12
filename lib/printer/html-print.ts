'use client';

/**
 * Shared HTML print path used by both the bill printer and the KOT printer.
 *
 * Two rules this file exists to enforce:
 *
 * 1. The load listener is attached BEFORE the iframe is navigated. Assigning
 *    `iframe.onload` after `document.close()` - what the original code did - is
 *    always too late, because close() fires the load event first. print() was
 *    never called and every HTML print was a silent no-op.
 *
 * 2. The iframe is released only once the browser reports the print job is
 *    finished. Removing it on a fixed 1s timer tore the source document away
 *    while Chrome was still generating the job, which on a 58mm thermal printer
 *    produced a receipt truncated after the header and left the printer waiting
 *    for bytes that never arrived - wedging the Windows queue until the printer
 *    was power-cycled.
 */

/** The document should be ready well inside this; we print anyway if it is not. */
const LOAD_TIMEOUT_MS = 10_000;

/** Safety net for engines that never deliver `afterprint`, so the frame cannot leak. */
const PRINT_TIMEOUT_MS = 60_000;

/** CSS reference pixel is 1/96in; used to turn a measured height into millimetres. */
const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

/** Absorbs sub-millimetre rounding so the tail cannot spill onto a second strip. */
const PAGE_SLACK_MM = 2;

/** Stops a runaway measurement from feeding metres of blank paper. */
const MAX_PAGE_HEIGHT_MM = 1200;

/** Roll width these receipts are laid out for. */
const DEFAULT_PAGE_WIDTH_MM = 58;

/**
 * Pins the page box to the roll width and the receipt's own height.
 *
 * The stylesheets used to declare `@page { size: 58mm auto }`, which looks
 * right and is invalid: the CSS grammar is `<length>{1,2} | auto | <page-size>`,
 * so a length paired with `auto` matches nothing and the browser drops the
 * whole declaration. Chrome then fell back to the driver's default paper, laid
 * the receipt out on US Letter, and the thermal driver printed only the
 * top-left fragment that fitted the 58mm head - a bill truncated just after the
 * header, identically on Windows and Linux.
 *
 * Measuring the content and emitting an explicit two-value size keeps the whole
 * receipt on exactly one page with no trailing blank feed. Screen and print
 * layout are the same here (the sheets only restate the 58mm width for print),
 * so a screen-context measurement is accurate.
 */
function applyExactPageSize(frameWindow: Window, pageWidthMm: number): void {
  const doc = frameWindow.document;
  const contentPx = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    doc.body?.scrollHeight ?? 0,
  );
  if (contentPx <= 0) return;

  const heightMm = Math.min(
    Math.ceil((contentPx * MM_PER_INCH) / CSS_PX_PER_INCH) + PAGE_SLACK_MM,
    MAX_PAGE_HEIGHT_MM,
  );

  const style = doc.createElement('style');
  // Appended last so it wins over the sheet baked into the receipt HTML.
  style.textContent = `@page { size: ${pageWidthMm}mm ${heightMm}mm; margin: 0; }`;
  doc.head.appendChild(style);
}

/**
 * Renders `html` in an off-screen iframe and drives the browser print dialog.
 * Resolves once `print()` has been invoked - the iframe outlives this promise
 * and is torn down when the print job actually completes.
 */
export async function printHTML(
  html: string,
  pageWidthMm: number = DEFAULT_PAGE_WIDTH_MM,
): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';

  // Executor form on purpose: Promise.withResolvers() needs Node 22 / Chrome 119,
  // and this ships to CI on Node 18/20 and to Android tablets on older Chrome.
  let settleLoad: (loaded: boolean) => void = () => undefined;
  const loaded = new Promise<boolean>((resolve) => {
    settleLoad = resolve;
  });
  iframe.addEventListener('load', () => settleLoad(true), { once: true });
  const loadTimer = setTimeout(() => settleLoad(false), LOAD_TIMEOUT_MS);

  // srcdoc must be set before insertion so the listener above cannot miss the event.
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(loadTimer);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  try {
    if (!(await loaded)) {
      // A partially-loaded receipt still beats printing nothing at all.
      console.warn('🖨️ Print iframe load timed out - printing anyway');
    }

    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      console.error('🖨️ Print iframe has no window');
      release();
      return false;
    }

    releaseWhenPrintFinishes(frameWindow, release);

    // Must run after load: the height is only known once the receipt has laid out.
    try {
      applyExactPageSize(frameWindow, pageWidthMm);
    } catch (error) {
      // Falls back to the sheet's own @page rule rather than losing the print.
      console.warn('🖨️ Could not pin the page size:', error);
    }

    try {
      frameWindow.focus();
    } catch {
      /* best effort: some embedded browsers throw, and that must not stop the print */
    }
    frameWindow.print();
    return true;
  } catch (error) {
    console.error('🖨️ HTML print failed:', error);
    release();
    return false;
  }
}

/**
 * Keeps the print source alive until the job is done.
 *
 * Chrome fires `afterprint` on the frame that called print(); some engines fire
 * it on the top window instead, so both are observed. The timeout is a leak
 * guard, not the normal path.
 */
function releaseWhenPrintFinishes(frameWindow: Window, release: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    clearTimeout(timer);
    frameWindow.removeEventListener('afterprint', finish);
    window.removeEventListener('afterprint', finish);
    // One task turn of slack so the engine can flush before the source vanishes.
    setTimeout(release, 0);
  };

  timer = setTimeout(finish, PRINT_TIMEOUT_MS);
  frameWindow.addEventListener('afterprint', finish);
  window.addEventListener('afterprint', finish);
}
