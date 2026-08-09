'use client';

/**
 * KOT (Kitchen Order Ticket) Printer
 * 
 * Uses SAME printer settings as customer bills.
 * Respects Bluetooth toggle - if disabled, prints HTML only (no dialog).
 */

export interface KOTData {
  canteenName?: string;
  orderNumber: string | number;
  serialNumber?: number;
  createdAt: string;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
  }>;
  customerName?: string;
  customerPhone?: string;
  customerRoll?: string;
  customerAddress?: string;
  orderType?: string;
  tableNumber?: string;
  specialInstructions?: string;
}

// Import shared helpers from billing printer
import { isWebBluetoothAvailable, printRawData, printViaUSB, getSavedPrinterId as getSharedPrinterId, applyExactPageSize } from './pwa-printer';

// Get saved printer ID (SHARED with billing)
function getSavedPrinterId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bluetooth-printer-id');
}

// Check if Bluetooth is enabled (SHARED with billing)
function isBluetoothEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem('printer-bluetooth-enabled');
  return saved !== null ? JSON.parse(saved) : true;
}

// Shared device cache is now managed in pwa-printer.ts

// Toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Redundant connection logic removed - now handled by printRawData in pwa-printer.ts

/**
 * Print KOT via Bluetooth (uses SAME settings as billing)
 */
/**
 * Print KOT via Bluetooth (uses EXACT SAME logic as billing via printRawData)
 */
async function printKOTViaBluetooth(kotData: KOTData): Promise<boolean> {
  try {
    const commands = buildKOTESCPOSCommands(kotData);
    return await printRawData(commands);
  } catch (error) {
    console.error('KOT Command Build failed:', error);
    return false;
  }
}

/**
 * Main KOT print function
 * Respects Bluetooth toggle - if OFF, uses HTML only (NO dialog)
 */
export async function printKOT(kotData: KOTData, forceThermal?: boolean) {
  // USB cable first, when one was paired in Settings. Checked ahead of the
  // Bluetooth toggle on purpose: a counter running USB keeps Bluetooth off, and
  // that must not push the ticket into the print dialog. A no-op when no USB
  // printer is paired, so the Bluetooth flow below is unchanged.
  if (forceThermal !== false && (await printViaUSB(buildKOTESCPOSCommands(kotData)))) return;

  const bluetoothEnabled = isBluetoothEnabled();
  
  // If Bluetooth is disabled, skip thermal and go straight to HTML
  if (!bluetoothEnabled) {
    console.log('📄 Bluetooth disabled - using HTML print');
    printKOTViaIframe(kotData);
    return;
  }
  
  // If Bluetooth is enabled, try thermal first
  if (forceThermal !== false) {
    const printed = await printKOTViaBluetooth(kotData);
    if (printed) return;
    
    // If we are here, Bluetooth print failed.
    // If the user hasn't even paired a printer, maybe fallback is okay?
    // But if they paired and it failed, fallback is annoying.
    if (getSavedPrinterId()) {
       console.log('❌ Bluetooth print failed - Not falling back to HTML to avoid dialog spam');
       showToast('❌ Print failed. Check printer connection.', 'error');
       // Don't fallback if we expected Bluetooth to work
       return; 
    }
  }
  
  // Fallback to HTML (only if no Bluetooth printer is saved, or Bluetooth is disabled)
  printKOTViaIframe(kotData);
}

/**
 * Build ESC/POS commands for KOT
 */
function buildKOTESCPOSCommands(data: KOTData): Uint8Array {
  const ESC = 0x1B;
  const GS = 0x1D;
  const LF = 0x0A;
  
  const W = 32;
  const DASH_LINE = '--------------------------------';
  
  const commands: number[] = [];
  
  commands.push(ESC, 0x40);
  
  // Header
  commands.push(ESC, 0x61, 0x01);
  commands.push(GS, 0x42, 0x01);
  commands.push(ESC, 0x45, 0x01);
  addText(commands, 'ZLICE KOT');
  commands.push(LF);
  commands.push(GS, 0x42, 0x00);
  commands.push(ESC, 0x45, 0x00);
  
  // Order number
  commands.push(ESC, 0x45, 0x01);
  commands.push(GS, 0x21, 0x11); // Double Width & Height (Reduced from 0x33)
  addText(commands, `#${data.serialNumber || '-'}`);
  commands.push(LF);
  commands.push(GS, 0x21, 0x00); // Reset
  commands.push(ESC, 0x45, 0x00);
  
  // Order info
  commands.push(ESC, 0x61, 0x01);
  const date = new Date(data.createdAt);
  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  
  let orderLine = `${data.orderNumber}`;
  if (timeStr) orderLine += ` ${timeStr}`;
  if (data.orderType) orderLine += ` [${data.orderType.toUpperCase()}]`;
  
  addText(commands, orderLine);
  commands.push(LF);
  
  // Table number
  if (data.tableNumber) {
    commands.push(ESC, 0x45, 0x01);
    addText(commands, `TABLE: ${data.tableNumber}`);
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
  }
  commands.push(LF);
  addText(commands, DASH_LINE);
  commands.push(LF);
  
  // Table header
  commands.push(ESC, 0x61, 0x00);
  commands.push(ESC, 0x45, 0x01);
  const qtyColWidth = 5;
  addText(commands, 'QTY'.padEnd(qtyColWidth) + 'ITEM');
  commands.push(ESC, 0x45, 0x00);
  commands.push(LF);
  
  // Items
  commands.push(GS, 0x21, 0x01); // Double Height for Items
  data.items.forEach((item) => {
    const qtyStr = `${item.quantity}x`;
    const qtyCol = qtyStr.padEnd(qtyColWidth);
    
    const itemColWidth = W - qtyColWidth;
    const itemLines = wrapText(item.name, itemColWidth);
    
    commands.push(ESC, 0x45, 0x01);
    addText(commands, qtyCol + itemLines[0]);
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
    
    for (let i = 1; i < itemLines.length; i++) {
      addText(commands, '     ' + itemLines[i]);
      commands.push(LF);
    }
    
    if (item.notes) {
      commands.push(GS, 0x21, 0x00); // Reset size for notes
      addText(commands, '     (' + item.notes + ')');
      commands.push(LF);
      commands.push(GS, 0x21, 0x01); // Back to Double Height
    }
  });
  commands.push(GS, 0x21, 0x00); // Reset after items
  
  addText(commands, DASH_LINE);
  commands.push(LF);
  
  // Special instructions
  if (data.specialInstructions) {
    commands.push(ESC, 0x45, 0x01);
    addText(commands, '! NOTE:');
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
    wrapText(data.specialInstructions, W).forEach(line => {
      addText(commands, line);
      commands.push(LF);
    });
    addText(commands, DASH_LINE);
    commands.push(LF);
  }
  
  // Delivery info
  if (data.customerName && data.orderType === 'delivery') {
    commands.push(ESC, 0x45, 0x01);
    addText(commands, 'DELIVER TO:');
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
    addText(commands, data.customerName);
    commands.push(LF);
    if (data.customerPhone) {
      addText(commands, data.customerPhone);
      commands.push(LF);
    }
    if (data.customerAddress) {
      addText(commands, 'Address:');
      commands.push(LF);
      wrapText(data.customerAddress, W).forEach(line => {
        addText(commands, line);
        commands.push(LF);
      });
    }
    addText(commands, DASH_LINE);
    commands.push(LF);
  }
  
  // Footer
  commands.push(ESC, 0x61, 0x01);
  addText(commands, 'Kitchen Use Only');
  commands.push(LF);
  addText(commands, 'ZLICE');
  commands.push(LF, LF, LF);
  
  commands.push(GS, 0x56, 0x00);
  
  return new Uint8Array(commands);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  words.forEach(word => {
    if ((currentLine + ' ' + word).trim().length <= width) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.length > width ? word.substring(0, width) : word;
    }
  });
  if (currentLine) lines.push(currentLine);
  
  return lines;
}

function addText(commands: number[], text: string) {
  for (let i = 0; i < text.length; i++) {
    commands.push(text.charCodeAt(i));
  }
}

/**
 * Print KOT via iframe (HTML)
 */
function printKOTViaIframe(data: KOTData): void {
  const kotContent = generateHTMLKOT(data);
  
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(kotContent);
    iframeDoc.close();

    iframe.onload = () => {
      setTimeout(() => {
        // Must run inside this handler: the height is only known once the ticket
        // has laid out, and the page box has to be pinned before print() below.
        try {
          const frameWindow = iframe.contentWindow;
          if (frameWindow) applyExactPageSize(frameWindow);
        } catch (e) {
          // Falls back to the sheet's own @page rule rather than losing the print.
          console.warn('Could not pin the KOT page size:', e);
        }

        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.error('KOT Print failed:', e);
          alert('KOT Print failed. Please check your printer connection.');
        }
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 3000);
      }, 500);
    };
  }
}

/**
 * Generate HTML KOT
 */
function generateHTMLKOT(data: KOTData): string {
  const orderDate = new Date(data.createdAt);
  const formattedTime = orderDate.toLocaleTimeString('en-IN', { 
    hour: '2-digit', minute: '2-digit', hour12: true 
  });

  let orderLine = data.orderNumber;
  if (formattedTime) orderLine += ' ' + formattedTime;
  if (data.orderType) orderLine += ' [' + data.orderType.toUpperCase() + ']';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>KOT #${data.orderNumber}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800;900&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* Two explicit lengths, never a length paired with 'auto': that pairing is
           invalid per the CSS 'size' grammar, so the browser drops the whole
           declaration and falls back to the driver's default paper (US Letter),
           which a 58mm thermal driver renders as just the top fragment - the ticket
           truncated after the header. applyExactPageSize() replaces this at print
           time with the measured content height; this value is only the fallback,
           and the margin must stay 0 so the 58mm body cannot overflow the page box. */
        @page { 
          size: 58mm 297mm; 
          margin: 0;
        }
        
        @media print {
          html, body { 
            width: 58mm !important; 
            max-width: 58mm !important; 
          }
          * { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
        
        body { 
          font-family: 'Inter', Arial, sans-serif; 
          width: 58mm; 
          max-width: 58mm; 
          margin: 0; 
          padding: 0;
          background: white; 
          font-size: 12px; 
          line-height: 1.1; 
          color: #000; 
          font-weight: 700;
        }
        
        .header {
          background: #000;
          color: white;
          text-align: center;
          padding: 2mm;
          margin: 0;
        }
        .header-text {
          font-size: 14px; 
          font-weight: 900;
          letter-spacing: 2px;
          margin: 0;
          padding: 0;
        }
        
        .order-number {
          text-align: center;
          font-size: 48px; 
          font-weight: 900;
          color: #000;
          margin: 0;
          padding: 1mm 0;
          line-height: 1;
        }
        
        .order-info {
          text-align: center;
          padding: 1mm 2mm 0 2mm;
          margin: 0;
          font-size: 11px; 
          font-weight: 700;
        }
        .table-number {
          text-align: center;
          padding: 0 2mm 1mm 2mm;
          margin: 0;
          font-size: 12px;
          font-weight: 900;
          color: #000;
          border-bottom: 1px solid #000;
        }
        .no-table {
          border-bottom: 1px solid #000;
          padding-bottom: 1mm;
        }
        
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin: 0;
          padding: 0;
        }
        .table-header {
          border: none;
        }
        .table-header th {
          text-align: left;
          padding: 1mm 2mm;
          font-size: 11px;
          font-weight: 900;
          color: #000;
          border: none;
        }
        .table-header .qty-col {
          width: 15%;
        }
        .table-header .item-col {
          width: 85%;
        }
        
        .items-row {
          border: none;
        }
        .items-row td {
          padding: 0.5mm 2mm;
          vertical-align: top;
          font-size: 12px;
          font-weight: 800;
          color: #000;
          border: none;
        }
        .qty-cell {
          font-weight: 900;
        }
        .item-cell {
          font-weight: 800;
          line-height: 1.2;
        }
        .item-notes {
          font-size: 10px;
          font-weight: 700;
          color: #333;
          margin-top: 0.5mm;
        }
        
        .table-footer {
          border-top: 1px solid #000;
        }
        .table-footer td {
          padding: 0;
          height: 1px;
        }
        
        .special-note {
          padding: 1mm 2mm;
          margin: 0;
          border-top: 1px solid #000;
        }
        .special-label {
          font-weight: 900;
          font-size: 11px;
          margin: 0 0 0.5mm 0;
        }
        .special-text {
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
        }
        
        .delivery {
          padding: 1mm 2mm;
          margin: 0;
          border-top: 1px solid #000;
        }
        .delivery-label {
          font-weight: 900;
          font-size: 11px;
          margin: 0 0 0.5mm 0;
        }
        .delivery-info {
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
        }
        
        .footer {
          text-align: center;
          padding: 1mm 2mm;
          margin: 0;
          font-size: 9px; 
          font-weight: 700;
          color: #000;
          border-top: 1px solid #000;
        }
        .footer-line {
          margin: 0.5mm 0;
        }
        .zlice-brand {
          font-weight: 900;
          font-size: 10px;
          letter-spacing: 1px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-text">ZLICE KOT</div>
      </div>
      
      <div class="order-number">#${data.serialNumber || '-'}</div>
      
      <div class="order-info${!data.tableNumber ? ' no-table' : ''}">  ${orderLine}</div>
      
      ${data.tableNumber ? `<div class="table-number">TABLE: ${data.tableNumber}</div>` : ''}
      
      <table class="items-table">
        <thead class="table-header">
          <tr>
            <th class="qty-col">QTY</th>
            <th class="item-col">ITEM</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map((item, index) => `
          <tr class="items-row">
            <td class="qty-cell">${item.quantity}x</td>
            <td class="item-cell">
              ${item.name}
              ${item.notes ? `<div class="item-notes">(${item.notes})</div>` : ''}
            </td>
          </tr>
          `).join('')}
        </tbody>
        <tfoot class="table-footer">
          <tr>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
      
      ${data.specialInstructions ? `
      <div class="special-note">
        <div class="special-label">! NOTE:</div>
        <div class="special-text">${data.specialInstructions}</div>
      </div>
      ` : ''}
      
      ${data.customerName && data.orderType === 'delivery' ? `
      <div class="delivery">
        <div class="delivery-label">DELIVER TO:</div>
        <div class="delivery-info">${data.customerName}</div>
        ${data.customerPhone ? `<div class="delivery-info">${data.customerPhone}</div>` : ''}
        ${data.customerAddress ? `<div class="delivery-info">${data.customerAddress}</div>` : ''}
      </div>
      ` : ''}
      
      <div class="footer">
        <div class="footer-line">Kitchen Use Only</div>
        <div class="footer-line zlice-brand">ZLICE</div>
      </div>
    </body>
    </html>
  `;
}
