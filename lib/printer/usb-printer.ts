'use client';

/**
 * WebUSB transport for USB-cabled ESC/POS thermal printers.
 *
 * Why this exists: the ESC/POS byte builders in pwa-printer.ts / kot-printer.ts
 * were already correct, but the only way to reach paper was Bluetooth. A counter
 * running a USB printer therefore always degraded to printHTML() -> the browser
 * print dialog, which hands the OS a PDF and leaves the rendering to whatever
 * driver is installed. Against a queue with no ESC/POS driver that prints the
 * literal bytes of the PDF ("%PDF-1.7 ... /FlateDecode ...") on the roll instead
 * of a bill. Talking to the printer over USB removes the driver from the loop
 * entirely: the same bytes that work over Bluetooth go straight down the wire.
 *
 * Windows note: Chrome/Edge reach USB devices through WinUSB. A printer bound to
 * the stock usbprint.sys class driver is owned by the spooler and claimInterface
 * fails - see docs/THERMAL_PRINTER_SETUP.md for the two supported deployments.
 * Every failure here returns false rather than throwing, so the caller falls
 * through to Bluetooth and then to the print dialog and the bill is never lost.
 */

/** USB class code for printers (bInterfaceClass 7), per the USB spec. */
const USB_PRINTER_CLASS = 0x07;

/**
 * Bytes per transferOut. USB bulk is flow-controlled by NAK, so pacing delays of
 * the kind the BLE path needs are unnecessary, but cheap printer firmware can
 * mishandle very large single transfers - chunking keeps each one small.
 */
const CHUNK_SIZE_BYTES = 512;

const SAVED_USB_NAME_KEY = 'printer-usb-name';

/** Live handle for the session. Reopening per job is wasteful and can race. */
let cachedDevice: USBDevice | null = null;

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isWebUSBAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

/** Human-readable label for the paired USB printer, for the settings screen. */
export function getSavedUSBPrinterName(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SAVED_USB_NAME_KEY);
}


export function forgetUSBPrinter(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVED_USB_NAME_KEY);
  // The browser-side grant is dropped too where supported, otherwise the device
  // keeps coming back from getDevices() and "forget" would not actually forget.
  void cachedDevice?.forget?.().catch(() => undefined);
  cachedDevice = null;
}

/**
 * A device the user has already granted this origin access to, if any.
 *
 * Never opens a chooser: WebUSB grants are persistent per-origin, so a printer
 * paired once in Settings is picked up silently on every later print - that is
 * what makes unattended counter printing possible.
 */
export async function getAuthorizedUSBPrinter(): Promise<USBDevice | null> {
  if (!isWebUSBAvailable()) return null;

  try {
    const devices = await navigator.usb.getDevices();
    if (devices.length === 0) return null;
    // Prefer a real printer-class device; fall back to the sole grant we have.
    return devices.find(isPrinterDevice) ?? devices[0] ?? null;
  } catch (error) {
    console.error('❌ USB getDevices failed:', errMessage(error));
    return null;
  }
}

function isPrinterDevice(device: USBDevice): boolean {
  if (device.deviceClass === USB_PRINTER_CLASS) return true;
  return device.configurations.some((configuration) =>
    configuration.interfaces.some((iface) =>
      iface.alternates.some((alt) => alt.interfaceClass === USB_PRINTER_CLASS),
    ),
  );
}

/**
 * Opens the browser device chooser. Requires transient activation, so this may
 * only be called straight out of a click handler (the Settings pair button).
 */
export async function requestUSBPrinter(): Promise<USBDevice | null> {
  if (!isWebUSBAvailable()) return null;

  try {
    // Printer-class filter first. Some clones misreport their descriptors, so a
    // second unfiltered pass keeps them selectable rather than showing an empty
    // chooser with no explanation.
    let device: USBDevice;
    try {
      device = await navigator.usb.requestDevice({
        filters: [{ classCode: USB_PRINTER_CLASS }],
      });
    } catch (error) {
      // NotFoundError from a filtered call means "nothing matched or dismissed".
      if (!(error instanceof Error && error.name === 'NotFoundError')) throw error;
      device = await navigator.usb.requestDevice({ filters: [] });
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        SAVED_USB_NAME_KEY,
        device.productName ||
          device.manufacturerName ||
          `USB ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId
            .toString(16)
            .padStart(4, '0')}`,
      );
    }
    cachedDevice = device;
    return device;
  } catch (error) {
    // NotFoundError is the user dismissing the chooser - not worth logging loudly.
    if (!(error instanceof Error && error.name === 'NotFoundError')) {
      console.error('❌ USB requestDevice failed:', errMessage(error));
    }
    return null;
  }
}

/** The claimable printer interface plus the bulk OUT endpoint that takes data. */
interface PrinterEndpoint {
  interfaceNumber: number;
  endpointNumber: number;
}

function findPrinterEndpoint(device: USBDevice): PrinterEndpoint | null {
  const configuration = device.configuration ?? device.configurations[0];
  if (!configuration) return null;

  for (const iface of configuration.interfaces) {
    for (const alt of iface.alternates) {
      // Restricting to the printer class avoids claiming an unrelated interface
      // on composite devices (some of these units also expose a HID endpoint).
      if (alt.interfaceClass !== USB_PRINTER_CLASS) continue;
      const out = alt.endpoints.find(
        (endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk',
      );
      if (out) {
        return { interfaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber };
      }
    }
  }
  return null;
}

async function openDevice(device: USBDevice): Promise<PrinterEndpoint | null> {
  if (!device.opened) await device.open();

  // A device that reports no active configuration has to be told which to use.
  if (!device.configuration) {
    await device.selectConfiguration(device.configurations[0]?.configurationValue ?? 1);
  }

  const endpoint = findPrinterEndpoint(device);
  if (!endpoint) return null;

  await device.claimInterface(endpoint.interfaceNumber);
  return endpoint;
}

/**
 * Writes raw ESC/POS bytes to the paired USB printer.
 *
 * Returns false (never throws) when no printer is paired or the write fails, so
 * the caller can fall through to the next transport.
 */
export async function printRawUSB(commands: Uint8Array): Promise<boolean> {
  const device = cachedDevice ?? (await getAuthorizedUSBPrinter());
  if (!device) return false;
  cachedDevice = device;

  let endpoint: PrinterEndpoint | null = null;
  try {
    endpoint = await openDevice(device);
    if (!endpoint) throw new Error('No bulk OUT endpoint on the printer interface');

    for (let i = 0; i < commands.length; i += CHUNK_SIZE_BYTES) {
      const chunk = commands.slice(i, i + CHUNK_SIZE_BYTES);
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== 'ok') throw new Error(`USB transfer ${result.status}`);
    }

    return true;
  } catch (error) {
    console.error('❌ USB print error:', errMessage(error));
    // Drop the handle so the next attempt re-opens: after a power-cycle or a
    // cable pull the old handle is permanently stale and every write would fail.
    cachedDevice = null;
    return false;
  } finally {
    // Released even on success. Holding the claim across jobs blocks any other
    // process from the device and survives longer than the printer does.
    if (endpoint) {
      await device.releaseInterface(endpoint.interfaceNumber).catch(() => undefined);
    }
    await device.close().catch(() => undefined);
  }
}
