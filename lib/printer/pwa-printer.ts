'use client';

import {
  getAuthorizedUSBPrinter,
  isWebUSBAvailable,
  printRawUSB,
} from './usb-printer';
import { printHTML } from './html-print';

/**
 * PWA Printer Utility
 * 
 * Implements hybrid printing approach for PWA:
 * 1. Try Web Bluetooth (direct, silent printing)
 * 2. Fallback to window.print() (system dialog)
 * 
 * Best for: Installed PWA on Android with Chrome/Edge
 */

export interface ReceiptData {
  canteenName?: string;
  address?: string;
  phone?: string;
  orderNumber: string | number;
  serialNumber?: number;
  createdAt: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  gst?: number;
  packagingFee?: number;
  deliveryFee?: number;
  total: number;
  customerName?: string;
  customerPhone?: string;
  customerRoll?: string;
  customerAddress?: string;
  orderType?: string;
  paymentMethod?: string;
  paymentStatus?: string;
}

interface RequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
  acceptAllDevices?: boolean;
  optionalServices?: string[];
}

// Cache for the connected Bluetooth device
let cachedDevice: BluetoothDevice | null = null;

// Allow external components (like Settings) to update the cache
export function setCachedDevice(device: BluetoothDevice) {
  cachedDevice = device;
  console.log('🧠 Printer cached in memory:', device.name);
}

export function getCachedDevice(): BluetoothDevice | null {
  return cachedDevice;
}

// Get saved printer device ID from localStorage
// Get saved printer device ID from localStorage
export function getSavedPrinterId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = localStorage.getItem('bluetooth-printer-id');
  console.log('🔍 getSavedPrinterId:', id);
  return id;
}

// Save printer device ID to localStorage
function savePrinterId(deviceId: string, deviceName?: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('bluetooth-printer-id', deviceId);
  if (deviceName) {
    localStorage.setItem('bluetooth-printer-name', deviceName);
  }
  console.log('💾 Saved printer to localStorage:', { id: deviceId, name: deviceName });
}

// Clear saved printer
export function forgetPrinter() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('bluetooth-printer-id');
  localStorage.removeItem('bluetooth-printer-name');
  cachedDevice = null;
  console.log('🗑️ Printer forgotten - localStorage cleared');
}

// Get saved printer name
export function getSavedPrinterName(): string | null {
  if (typeof window === 'undefined') return null;
  const name = localStorage.getItem('bluetooth-printer-name');
  console.log('🔍 getSavedPrinterName:', name);
  return name;
}

// Show toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  // Create toast element
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
    animation: slideUp 0.3s ease;
  `;
  
  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { bottom: 60px; opacity: 0; }
      to { bottom: 80px; opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(toast);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      document.body.removeChild(toast);
      document.head.removeChild(style);
    }, 300);
  }, 3000);
}

// Try to reconnect to previously paired device WITHOUT showing dialog
async function reconnectToSavedDevice(): Promise<BluetoothDevice | null> {
  const savedId = getSavedPrinterId();
  
  if (!savedId) {
    console.log('📭 No saved printer in localStorage');
    return null;
  }

  const savedName = getSavedPrinterName();
  console.log(`🔄 Attempting silent reconnect to: ${savedName || savedId}`);

  // FIRST: Check if we have a cached device in memory that can be reconnected
  if (cachedDevice && cachedDevice.id === savedId) {
    console.log('🧠 Found cached device in memory');
    if (cachedDevice.gatt?.connected) {
      console.log('✓ Cached device is already connected!');
      return cachedDevice;
    }
    
    // Try to reconnect the cached device with retries
    console.log('🔌 Trying to reconnect cached device...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        showToast(`🔍 Connecting... (attempt ${attempt}/3)`, 'info');
        await cachedDevice.gatt?.connect();
        console.log(`✅ Cached device reconnected on attempt ${attempt}`);
        showToast('🖨️ Printer connected', 'success');
        return cachedDevice;
      } catch (e: any) {
        console.log(`⚠️ Attempt ${attempt} failed:`, e.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s between retries
        }
      }
    }
  }

  // SECOND: Try getDevices API to find authorized device
  try {
    if (!navigator.bluetooth.getDevices) {
      console.log('⚠️ getDevices() not supported');
      return null;
    }

    const devices = await navigator.bluetooth.getDevices();
    console.log(`📱 Found ${devices.length} authorized device(s):`, devices.map(d => d.name || d.id));
    
    const savedDevice = devices.find(d => d.id === savedId);
    
    if (!savedDevice) {
      console.log('⚠️ Saved device not in authorized list');
      return null;
    }

    console.log(`✓ Found device: ${savedDevice.name || 'Unknown'}`);
    
    // If already connected, return immediately
    if (savedDevice.gatt?.connected) {
      console.log('✓ Already connected!');
      cachedDevice = savedDevice;
      return savedDevice;
    }

    // Try direct connect with RETRIES (3 attempts)
    console.log('🔌 Trying direct connection with retries...');
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        showToast(`🔍 Connecting... (attempt ${attempt}/3)`, 'info');
        await savedDevice.gatt?.connect();
        console.log(`✅ Direct connection succeeded on attempt ${attempt}!`);
        cachedDevice = savedDevice;
        showToast('🖨️ Printer connected', 'success');
        return savedDevice;
      } catch (directErr: any) {
        console.log(`⚠️ Attempt ${attempt} failed:`, directErr.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s between retries
        }
      }
    }

    // FALLBACK: Use watchAdvertisements with 15s timeout
    console.log('📡 Final attempt: Watching for advertisements (15s)...');
    showToast('🔍 Searching for printer (15s)...', 'info');
    
    const device = await new Promise<BluetoothDevice | null>((resolve) => {
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('⏱️ Watch timeout - device not responding');
          resolve(null);
        }
      }, 15000); // 15 seconds
      
      const handleAdvertisement = async () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        
        console.log('📶 Device advertisement received!');
        
        try {
          await savedDevice.gatt?.connect();
          console.log('✅ Connected via advertisement');
          resolve(savedDevice);
        } catch (err: any) {
          console.log('❌ Connection after advertisement failed:', err.message);
          resolve(null);
        }
      };
      
      // @ts-ignore
      if (savedDevice.watchAdvertisements) {
        // @ts-ignore
        savedDevice.addEventListener('advertisementreceived', handleAdvertisement);
        // @ts-ignore
        savedDevice.watchAdvertisements({ signal: AbortSignal.timeout(15000) }).catch(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('⚠️ watchAdvertisements ended without response');
            resolve(null);
          }
        });
      } else {
        clearTimeout(timeout);
        console.log('⚠️ watchAdvertisements not supported');
        resolve(null);
      }
    });

    if (device) {
      cachedDevice = device;
      showToast('🖨️ Printer connected', 'success');
      return device;
    }
    
    return null;
  } catch (error: any) {
    console.log('⚠️ Reconnection error:', error.message);
    return null;
  }
}

// Check if Web Bluetooth is available
export function isWebBluetoothAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'bluetooth' in navigator;
}

// Check if device is likely a mobile PWA
export function isPWAInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check multiple indicators
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone = (window.navigator as any).standalone === true;
  const isAndroidApp = document.referrer.includes('android-app://');
  
  // Also check if in fullscreen mode (common for PWAs)
  const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
  
  const isPWA = isStandalone || isIOSStandalone || isAndroidApp || isFullscreen;
  
  console.log('PWA Detection:', {
    isStandalone,
    isIOSStandalone, 
    isAndroidApp,
    isFullscreen,
    isPWA,
    displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
  });
  
  return isPWA;
}

/**
 * Check if Bluetooth is enabled in settings and device is connected
 * Returns true only if BOTH conditions are met:
 * 1. Bluetooth printing is enabled in localStorage settings
 * 2. A saved Bluetooth device is connected
 */
export async function isBluetoothEnabledAndConnected(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!isWebBluetoothAvailable()) return false;

  // Check if Bluetooth printing is enabled in settings
  const bluetoothEnabled = localStorage.getItem('printer-bluetooth-enabled');
  if (bluetoothEnabled === 'false') {
    console.log('ℹ️ Bluetooth printing disabled in settings');
    return false;
  }

  // Check if there's a saved printer device
  const savedId = getSavedPrinterId();
  if (!savedId) {
    console.log('ℹ️ No saved Bluetooth printer');
    return false;
  }

  try {
    // Check if getDevices is available (Chrome 85+)
    if (!navigator.bluetooth.getDevices) {
      console.log('⚠️ getDevices() not supported - assuming disconnected');
      return false;
    }

    // Get previously authorized devices
    const devices = await navigator.bluetooth.getDevices();
    const savedDevice = devices.find(d => d.id === savedId);

    if (!savedDevice) {
      console.log('ℹ️ Saved Bluetooth printer not in authorized list');
      return false;
    }

    // Check if device is connected via GATT
    const isConnected = savedDevice.gatt?.connected === true;
    console.log(`📱 Bluetooth device connection status: ${isConnected ? '✓ Connected' : '✗ Disconnected'}`);
    
    return isConnected;
  } catch (error) {
    console.error('Error checking Bluetooth connection:', error);
    return false;
  }
}

export async function printRawData(commands: Uint8Array): Promise<boolean> {
  if (!isWebBluetoothAvailable()) {
    console.log('❌ Web Bluetooth not available');
    return false;
  }

  let device: BluetoothDevice | null = null;

  try {
    // First check if we have a cached device that's still connected
    if (cachedDevice && cachedDevice.gatt?.connected) {
      console.log('⚡ Using cached connected device:', cachedDevice.name);
      device = cachedDevice;
    } else {
      // Try to reconnect to saved device (silent, no dialog)
      device = await reconnectToSavedDevice();
    }
    
    // If reconnection failed...
    if (!device) {
      const savedName = getSavedPrinterName();
      const savedId = getSavedPrinterId();
      
      // If we HAVE a saved printer name, try ONE MORE attempt with requestDevice(name filter)
      // This handles cases where getDevices() failed or browser lost pairing
      if (savedName) {
        console.log(`🔄 Final attempt: Using requestDevice with name filter for "${savedName}"...`);
        showToast(`🔍 Looking for "${savedName}"...`, 'info');
        
        try {
          const requestOptions: RequestDeviceOptions = {
            filters: [{ name: savedName }],
            optionalServices: [
              '000018f0-0000-1000-8000-00805f9b34fb',
              '49535343-fe7d-4ae5-8fa9-9fafd205e455',
              'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
              '0000fff0-0000-1000-8000-00805f9b34fb'
            ]
          };
          
          device = await navigator.bluetooth.requestDevice(requestOptions);
          
          if (device) {
            console.log(`✅ Found printer via name filter: ${device.name}`);
            
            // Connect it
            if (!device.gatt?.connected) {
              showToast('🔌 Connecting...', 'info');
              await device.gatt?.connect();
            }
            
            // Update cache
            cachedDevice = device;
            savePrinterId(device.id, device.name || undefined);
            showToast('🖨️ Printer reconnected!', 'success');
          }
        } catch (error: any) {
          if (error.name === 'NotFoundError' || error.message?.includes('User cancelled')) {
            console.log('👤 User cancelled or printer not found');
            showToast(`❌ "${savedName}" not found. Is it turned on?`, 'error');
            return false;
          }
          console.error('requestDevice with filter failed:', error);
        }
      }
      
      // If STILL no device after all attempts
      if (!device) {
        if (savedId) {
          // We tried everything, show error
          console.log('❌ All reconnection attempts failed');
          showToast('❌ Printer not responding. Please check if it is turned on and nearby.', 'error');
          return false;
        }
        
        // No saved printer - this is first-time setup, show device picker
        console.log('🔵 First-time setup: Requesting Bluetooth device...');
        
        try {
          const requestOptions: RequestDeviceOptions = {
            acceptAllDevices: true,
            optionalServices: [
              '000018f0-0000-1000-8000-00805f9b34fb',
              '49535343-fe7d-4ae5-8fa9-9fafd205e455',
              'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
              '0000fff0-0000-1000-8000-00805f9b34fb'
            ]
          };
          
          device = await navigator.bluetooth.requestDevice(requestOptions);
        } catch (error: any) {
          if (error.name === 'NotFoundError' || error.message?.includes('User cancelled')) {
            showToast('❌ Printer selection cancelled', 'error');
            return false;
          }
          throw error; 
        }
      }

      if (!device) return false;

      // Save the device info
      if (!savedId || device.id !== savedId) {
        savePrinterId(device.id, device.name || undefined);
        cachedDevice = device;
        showToast(`✅ Saved: ${device.name || 'Printer'}`, 'success');
      }
      
      if (!device.gatt?.connected) {
        await device.gatt?.connect();
      }
    }

    const server = device.gatt;
    if (!server?.connected) {
      throw new Error('GATT server not connected');
    }

    // Try multiple service UUIDs
    const serviceUUIDs = [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      '0000fff0-0000-1000-8000-00805f9b34fb'
    ];

    let service = null;
    let characteristic = null;

    for (const serviceUUID of serviceUUIDs) {
      try {
        service = await server.getPrimaryService(serviceUUID);
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            characteristic = char;
            break;
          }
        }
        if (characteristic) break;
      } catch (e) {
        continue;
      }
    }

    if (!characteristic) {
      throw new Error('Could not find writable characteristic on printer');
    }

    // Send to printer in chunks
    const chunkSize = 20; 
    for (let i = 0; i < commands.length; i += chunkSize) {
      const chunk = commands.slice(i, i + chunkSize);
      try {
        if (characteristic.properties.writeWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
      } catch (e) {
        console.error('Error writing chunk:', e);
        throw e;
      }
      await new Promise(resolve => setTimeout(resolve, 50)); 
    }

    showToast('✅ Printed successfully', 'success');
    
    // DON'T disconnect! Keep connection alive for session.
    // User reported repeated dialogs because we were disconnecting after each print.
    // setTimeout(() => {
    //   if (device) {
    //     device.gatt?.disconnect();
    //   }
    // }, 1000);
    
    return true;

  } catch (error: any) {
    console.error('❌ Bluetooth print error:', error.message);
    showToast('❌ Print failed: ' + error.message, 'error');
    if (error.message?.includes('GATT') || error.message?.includes('connect')) {
      forgetPrinter();
    }
    return false;
  }
}


/**
 * Writes raw ESC/POS bytes down the USB cable when a printer has been paired in
 * Settings, otherwise reports false so the caller drops through to its existing
 * Bluetooth path untouched.
 *
 * Silent by design: getAuthorizedUSBPrinter() only ever returns a device the
 * user already granted, so this can never pop a device chooser mid-order.
 */
export async function printViaUSB(commands: Uint8Array): Promise<boolean> {
  if (!isWebUSBAvailable()) return false;
  if (!(await getAuthorizedUSBPrinter())) return false;

  if (await printRawUSB(commands)) {
    showToast('✅ Printed successfully', 'success');
    return true;
  }

  showToast('⚠️ USB printer did not respond - trying Bluetooth', 'info');
  return false;
}

export async function printViaBluetoothESCPOS(receiptData: ReceiptData): Promise<boolean> {
    console.log('🖨️ Building print commands...');
    const commands = buildESCPOSCommands(receiptData);
    return printRawData(commands);
}

/**
 * Build ESC/POS command bytes for thermal printer
 * Clean, simple receipt for 58mm (32 char) thermal printer
 * Full width, justified alignment, consistent margins
 */
function buildESCPOSCommands(data: ReceiptData): Uint8Array {
  const ESC = 0x1B;
  const GS = 0x1D;
  const LF = 0x0A;
  
  // Column count and font MUST be chosen together. A 58mm head is 384 dots, so
  // Font A (12 dots wide) gives 32 columns and Font B (9 dots) gives 42. This
  // layout is built at 42, which only holds once ESC M 1 has selected Font B -
  // without it the printer stays in Font A after ESC @ and every separator,
  // item and total row wraps at column 32, shredding the bill into ragged
  // half-lines. The KOT sheet is laid out at 32 and stays in Font A.
  const W = 42;
  const LINE = '-'.repeat(W);
  const DLINE = '='.repeat(W);
  
  const commands: number[] = [];
  
  // Initialize printer
  commands.push(ESC, 0x40);
  commands.push(ESC, 0x4d, 0x01); // Font B: 42 columns, matching W above.
  
  // ========== HEADER - ZLICE BRANDING ==========
  commands.push(ESC, 0x61, 0x01); // Center align
  commands.push(ESC, 0x45, 0x01); // Bold on
  commands.push(ESC, 0x34);       // Italic on
  commands.push(GS, 0x21, 0x11);  // Double width + height
  addText(commands, 'ZLICE');
  commands.push(LF);
  commands.push(GS, 0x21, 0x00); // Normal size
  commands.push(ESC, 0x35);      // Italic off
  commands.push(ESC, 0x45, 0x00); // Bold off
  addText(commands, 'Your Campus Food Partner');
  commands.push(LF);
  addText(commands, LINE);
  commands.push(LF);
  
  // ========== CANTEEN INFO ==========
  commands.push(ESC, 0x45, 0x01); // Bold
  addText(commands, (data.canteenName || 'CANTEEN').toUpperCase());
  commands.push(ESC, 0x45, 0x00);
  commands.push(LF);
  
  if (data.address) {
    // Wrap address if needed
    wrapText(data.address, W).forEach(line => {
      addText(commands, line);
      commands.push(LF);
    });
  }
  if (data.phone) {
    addText(commands, `Tel: ${data.phone}`);
    commands.push(LF);
  }
  
  addText(commands, DLINE);
  commands.push(LF);
  
  // ========== ORDER INFO ==========
  commands.push(ESC, 0x45, 0x01); // Bold
  addText(commands, `ORDER: #${data.serialNumber || data.orderNumber}`);
  commands.push(ESC, 0x45, 0x00);
  commands.push(LF);
  
  const date = new Date(data.createdAt);
  const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  addText(commands, `${dateStr} | ${timeStr}`);
  commands.push(LF);
  
  if (data.orderType || data.paymentMethod) {
    let info = data.orderType ? data.orderType.toUpperCase() : '';
    if (data.paymentMethod) info += (info ? ' | ' : '') + data.paymentMethod.toUpperCase();
    addText(commands, info);
    commands.push(LF);
  }
  
  addText(commands, DLINE);
  commands.push(LF);
  
  // ========== CUSTOMER / DELIVERY INFO ==========
  if (data.customerName) {
    commands.push(ESC, 0x61, 0x01); // Center align
    commands.push(ESC, 0x45, 0x01); // Bold
    addText(commands, 'DELIVER TO:');
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
    addText(commands, data.customerName);
    commands.push(LF);
    if (data.customerPhone) {
      addText(commands, `Phone: ${data.customerPhone}`);
      commands.push(LF);
    }

    // SHOW CUSTOMER ADDRESS
    if (data.customerAddress) {
      addText(commands, 'Address:');
      commands.push(LF);
      wrapText(data.customerAddress, W).forEach(line => {
        addText(commands, line);
        commands.push(LF);
      });
    }
    addText(commands, LINE);
    commands.push(LF);
  }
  
  // ========== ITEMS TABLE ==========
  commands.push(ESC, 0x61, 0x01); // Center align for table
  commands.push(ESC, 0x45, 0x01); // Bold header
  // Built from W, not a fixed literal: the item rows below are justified to W,
  // so a hardcoded 28-char header floated centred above 42-char rows and put
  // QTY/AMT nowhere near the columns they label.
  addText(commands, justifyLR('ITEM', 'QTY      AMT', W));
  commands.push(ESC, 0x45, 0x00);
  commands.push(LF);
  addText(commands, LINE);
  commands.push(LF);
  
  // Items - DOUBLE HEIGHT
  commands.push(GS, 0x21, 0x01); 
  data.items.forEach(item => {
    const amt = item.price * item.quantity;
    addText(commands, formatItem(item.name, item.quantity, amt, W));
    commands.push(LF);
  });
  commands.push(GS, 0x21, 0x00); // Reset
  
  addText(commands, LINE);
  commands.push(LF);
  
  // ========== BREAKDOWN ==========
  // DOUBLE HEIGHT FOR BREAKDOWN TOO
  commands.push(GS, 0x21, 0x01);
  addText(commands, justifyLR('Subtotal', `Rs ${data.subtotal.toFixed(2)}`, W));
  commands.push(LF);
  
  if (data.gst && data.gst > 0) {
    addText(commands, justifyLR('GST (5%)', `Rs ${data.gst.toFixed(2)}`, W));
    commands.push(LF);
  }
  
  if (data.packagingFee && data.packagingFee > 0) {
    addText(commands, justifyLR('Packaging', `Rs ${data.packagingFee.toFixed(2)}`, W));
    commands.push(LF);
  }
  
  if (data.deliveryFee && data.deliveryFee > 0) {
    addText(commands, justifyLR('Delivery', `Rs ${data.deliveryFee.toFixed(2)}`, W));
    commands.push(LF);
  }
  commands.push(GS, 0x21, 0x00); // Reset
  
  // ========== GRAND TOTAL ==========
  addText(commands, DLINE);
  commands.push(LF);
  commands.push(ESC, 0x45, 0x01); // Bold
  commands.push(GS, 0x21, 0x11); // Double width + height (Large Total)
  // When Double Width, we effectively have half the characters per line
  // So justified length should be W / 2
  addText(commands, justifyLR('TOTAL', `Rs ${data.total.toFixed(2)}`, Math.floor(W / 2))); 
  commands.push(GS, 0x21, 0x00);
  commands.push(ESC, 0x45, 0x00);
  commands.push(LF);
  addText(commands, DLINE);
  commands.push(LF);
  
  // ========== PAYMENT STATUS ==========
  if (data.paymentStatus) {
    commands.push(ESC, 0x61, 0x01); // Center
    commands.push(ESC, 0x45, 0x01);
    addText(commands, data.paymentStatus === 'paid' ? '[ PAID ]' : '[ UNPAID ]');
    commands.push(ESC, 0x45, 0x00);
    commands.push(LF);
  }
  
  // ========== FOOTER ==========
  commands.push(ESC, 0x61, 0x01); // Center
  commands.push(LF);
  addText(commands, 'Thank You for Ordering!');
  commands.push(LF);
  addText(commands, 'Visit Again Soon');
  commands.push(LF);
  addText(commands, LINE);
  commands.push(LF);
  addText(commands, 'Powered by ZLICE');
  commands.push(LF);
  addText(commands, 'www.zlice.in');
  commands.push(LF, LF, LF, LF, LF, LF, LF, LF); // Extra feed before cut
  
  // Cut paper
  commands.push(GS, 0x56, 0x00);
  
  return new Uint8Array(commands);
}

// Justify left and right within width
function justifyLR(left: string, right: string, width: number): string {
  const space = width - left.length - right.length;
  if (space < 1) return (left + ' ' + right).substring(0, width);
  return left + ' '.repeat(space) + right;
}

// Justify 3 columns (ITEM, QTY, AMT header)
function justifyLine(col1: string, col2: string, col3: string, width: number): string {
  // 16 chars for item, 8 for qty, 8 for amt
  return col1.padEnd(16) + col2.padStart(8) + col3.padStart(8);
}

// Format item: name left, qty center, amount right (total = 32 chars)
function formatItem(name: string, qty: number, amt: number, width: number): string {
  const qtyStr = `x${qty}`;
  const amtStr = `Rs${amt.toFixed(0)}`;
  const nameWidth = width - qtyStr.length - amtStr.length - 2; // 2 spaces
  
  const truncName = name.length > nameWidth 
    ? name.substring(0, nameWidth - 1) + '.' 
    : name;
  
  return justifyLR(truncName, `${qtyStr}  ${amtStr}`, width);
}

// Wrap long text into multiple lines
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

// Legacy compatibility
function formatItemLine32(name: string, qty: number, total: number): string {
  return formatItem(name, qty, total, 32);
}
function formatBreakdownLine32(label: string, amount: number): string {
  return justifyLR(label, `Rs ${amount.toFixed(2)}`, 32);
}
function formatTotalLine32(label: string, amount: number): string {
  return justifyLR(label, `Rs ${amount.toFixed(0)}`, 32);
}
function formatItemLineESC(name: string, qty: number, total: number): string {
  return formatItem(name, qty, total, 32);
}
function formatBreakdownLineESC(label: string, amount: number): string {
  return justifyLR(label, `Rs ${amount.toFixed(2)}`, 32);
}
function formatItemLine(name: string, qty: number, total: number): string {
  return formatItem(name, qty, total, 32);
}
function formatBreakdownLine(label: string, amount: number): string {
  return justifyLR(label, `Rs ${amount.toFixed(2)}`, 32);
}

/**
 * Main print function with fallback
 * Tries Bluetooth first (if enabled), falls back to window.print()
 */
export async function printReceipt(receiptData: ReceiptData): Promise<void> {
  // Check user preference
  const bluetoothEnabled = typeof localStorage !== 'undefined' 
    ? JSON.parse(localStorage.getItem('printer-bluetooth-enabled') ?? 'true')
    : true;

  console.log('🖨️ Print Request:', {
    bluetoothEnabled,
    hasSavedPrinter: !!getSavedPrinterName(),
    isPWA: isPWAInstalled(),
    hasWebBluetooth: isWebBluetoothAvailable()
  });

  // USB cable first, when one was paired in Settings. Deliberately checked
  // ahead of the Bluetooth preference: a counter running USB has the Bluetooth
  // toggle off, and that must not push the bill into the print dialog. When no
  // USB printer is paired this is a no-op and the Bluetooth flow below runs
  // exactly as it always has.
  if (await printViaUSB(buildESCPOSCommands(receiptData))) return;

  // If Bluetooth is disabled, go straight to window.print()
  if (!bluetoothEnabled) {
    console.log('ℹ️ Bluetooth printing disabled, using system print dialog');
    showToast('📄 Opening print dialog...', 'info');
    await printViaIframe(receiptData);
    return;
  }

  // If Bluetooth is enabled, only try Bluetooth (no fallback unless disabled)
  if (isWebBluetoothAvailable()) {
    console.log('🔵 Attempting Bluetooth print...');
    
    try {
      const success = await printViaBluetoothESCPOS(receiptData);
      
      if (success) {
        console.log('✅ Bluetooth print completed successfully');
        return; // Exit - do NOT fall back
      }
      
      // If Bluetooth failed, show error but DON'T fallback automatically
      console.log('❌ Bluetooth print failed');
      showToast('❌ Bluetooth print failed. Check printer or disable Bluetooth printing in settings.', 'error');
      return; // Don't fallback - user needs to fix Bluetooth or disable it
      
    } catch (error) {
      console.error('❌ Bluetooth exception:', error);
      showToast('❌ Bluetooth error. Disable Bluetooth printing in settings to use system dialog.', 'error');
      return; // Don't fallback
    }
  } else {
    // Bluetooth not available at all
    console.log('⚠️ Web Bluetooth not available on this browser');
    showToast('⚠️ Bluetooth not supported. Using system print dialog...', 'info');
    await printViaIframe(receiptData);
  }
}

/**
 * Fallback: browser print dialog.
 *
 * Delegates to printHTML() rather than driving an iframe here. The hand-rolled
 * version this replaces carried two faults that both ended as a bill truncated
 * after the header:
 *
 * 1. `iframe.onload` was assigned AFTER `iframeDoc.close()`. close() fires the
 *    load event synchronously, so the handler could be attached too late and
 *    print() was never reached at all.
 * 2. The iframe was removed on a fixed 3s timer. That tore the source document
 *    away while the browser was still generating the job, so the printer got a
 *    partial stream and sat waiting for bytes that never arrived - wedging the
 *    queue until it was power-cycled.
 *
 * printHTML() attaches the load listener before navigating and holds the frame
 * until `afterprint`, and pins the page box to the measured height.
 */
function printViaIframe(data: ReceiptData): Promise<boolean> {
  return printHTML(generateHTMLReceipt(data));
}

/**
 * Generate HTML receipt - Minimal, paper-saving, formal invoice design
 * Clean & professional with ZLICE branding
 */
function generateHTMLReceipt(data: ReceiptData): string {
  const orderDate = new Date(data.createdAt);
  const formattedDate = orderDate.toLocaleDateString('en-IN', { 
    day: '2-digit', month: 'short', year: 'numeric' 
  });
  const formattedTime = orderDate.toLocaleTimeString('en-IN', { 
    hour: '2-digit', minute: '2-digit', hour12: true 
  });

  // Get the origin for absolute URL (works in iframe)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const logoUrl = `${origin}/zlice-logo.png`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invoice #${data.serialNumber || data.orderNumber}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* margin must stay 0: a non-zero @page margin shrinks the page box below
           the 58mm body below it, and the overflow is either clipped on the right
           or spilled onto a second strip of paper. Side spacing is the body's
           padding instead, which is inside the page box. */
        /* Two explicit lengths, never a length paired with 'auto': that pairing is
           invalid per the CSS 'size' grammar, so the browser drops the whole
           declaration and falls back to the driver's default paper (US Letter),
           which a 58mm thermal driver renders as just the top fragment - the bill
           truncated after the header. applyExactPageSize() replaces this at print
           time with the measured content height; this value is only the fallback. */
        @page { size: 58mm 297mm; margin: 0; }
        
        @media print {
          html, body { width: 58mm !important; max-width: 58mm !important; }
          * { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
        
        body { 
          font-family: 'Inter', Arial, 'Helvetica Neue', sans-serif; 
          width: 58mm; max-width: 58mm; 
          margin: 0 auto; padding: 3mm;
          background: white; 
          font-size: 14px; 
          line-height: 1.5; 
          color: #000; 
          font-weight: 600;
        }
        
        /* HEADER - Canteen Name Only */
        .header {
          text-align: center;
          padding-bottom: 2.5mm;
          border-bottom: 2.5px solid #000;
          margin-bottom: 2.5mm;
        }
        .logo {
          max-width: 50%;
          height: auto;
          margin-bottom: 2mm;
          display: block;
          margin-left: auto;
          margin-right: auto;
          border-radius: 10px;
        }
        .canteen-name {
          font-size: 16px; 
          font-weight: 900;
          text-transform: uppercase;
          color: #000;
          letter-spacing: 0.5px;
        }
        
        .canteen-address, .canteen-phone {
          font-size: 11px;
          font-weight: 600;
          color: #000;
          text-align: center;
          line-height: 1.3;
        }

        /* ORDER INFO - Larger & Bolder */
        .order-row {
          display: flex; justify-content: space-between;
          align-items: center; 
          padding: 2.5mm 0;
          border-bottom: 2.5px solid #000;
          margin-bottom: 2.5mm;
        }
        .serial-num {
          font-size: 26px; 
          font-weight: 900;
          color: #000;
          margin-right: 2mm;
        }
        .order-id {
          font-size: 14px; 
          font-weight: 700;
          color: #000;
        }
        .order-date {
          font-size: 12px; 
          font-weight: 600;
          color: #000;
          text-align: right; 
          line-height: 1.4;
        }
        
        /* CUSTOMER - Clean Border */
        .customer {
          padding: 2mm;
          background: white;
          border: 2px dashed #000;
          border-left: 3px solid #000;
          margin-bottom: 2.5mm;
          font-size: 14px;
          border-radius: 3mm;
        }
        .customer-name { 
          font-weight: 800; 
          margin-bottom: 1mm;
          color: #000;
          font-size: 15px;
        }
        .customer-info { 
          color: #000; 
          font-size: 13px;
          font-weight: 600;
          line-height: 1.4;
        }
        
        /* ITEMS - Clear Table Layout */
        .items { margin-bottom: 2mm; }
        .items-header {
          display: flex; justify-content: space-between;
          padding: 2mm 0;
          border-bottom: 2.5px solid #000;
          margin-bottom: 1.5mm;
          font-weight: 900;
          font-size: 14px;
          color: #000;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .items-header-left { flex: 1; }
        .items-header-right { min-width: 15mm; text-align: right; }
        .item {
          display: flex; justify-content: space-between;
          padding: 2mm 0;
          border-bottom: 1px dashed #666;
        }
        .item:last-child { border-bottom: none; }
        .item-left { flex: 1; }
        .item-name { 
          font-size: 15px; 
          font-weight: 700;
          color: #000;
          line-height: 1.3;
        }
        .item-qty { 
          font-size: 13px; 
          font-weight: 600;
          color: #000;
          margin-top: 0.5mm;
        }
        .item-amt { 
          font-size: 16px; 
          font-weight: 800;
          color: #000;
          text-align: right; 
          min-width: 15mm; 
        }
        
        /* SUMMARY - Clean Separation */
        .summary {
          border-top: 2px dashed #000;
          padding-top: 2mm;
          margin-bottom: 2.5mm;
        }
        .sum-row {
          display: flex; justify-content: space-between;
          padding: 1mm 0; 
          font-size: 14px;
        }
        .sum-row span:first-child { 
          color: #000;
          font-weight: 700;
        }
        .sum-row span:last-child { 
          font-weight: 800;
          color: #000;
        }
        
        /* TOTAL - Clean & Bold */
        .total {
          background: white;
          color: #000;
          padding: 2.5mm 0;
          border-top: 2.5px dashed #000;
          border-bottom: 2.5px dashed #000;
          display: flex; 
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2mm;
          margin-top: 1mm;
        }
        .total-label { 
          font-size: 18px; 
          font-weight: 900;
          letter-spacing: 1.2px;
        }
        .total-amt { 
          font-size: 28px; 
          font-weight: 900;
          margin-left: 3mm;
        }
        
        /* PAYMENT STATUS - Clean Border */
        .status {
          text-align: center;
          padding: 2.5mm;
          font-size: 15px; 
          font-weight: 900;
          border-radius: 2mm;
          margin-bottom: 2mm;
          letter-spacing: 0.8px;
        }
        .paid { 
          background: white; 
          color: #000; 
          border: 2.5px solid #000; 
        }
        .pending { 
          background: white; 
          color: #000; 
          border: 2.5px dashed #000; 
        }
        
        /* FOOTER - Minimal Branding */
        .footer {
          text-align: center;
          padding-top: 2mm;
          border-top: 1.5px dotted #000;
          font-size: 10px; 
          font-weight: 600;
          color: #000;
          flex-direction: row;
        }
        .footer .brand { 
          font-weight: 900;
          font-style: italic;
          font-size: 11px;
          letter-spacing: 1px;
          color: #000;
        }
        
        .spacer { height: 5mm; }
      </style>
    </head>
    <body>
      <!-- Header -->
      <div class="header">
        <img src="${logoUrl}" alt="ZLICE" class="logo" />
        <div class="canteen-name">${data.canteenName || 'Kitchen'}</div>
        ${data.address ? `<div class="canteen-address">${data.address}</div>` : ''}
        ${data.phone ? `<div class="canteen-phone">Ph: ${data.phone}</div>` : ''}
      </div>
      
      <!-- Order Info Row -->
      <div class="order-row">
        <div>
          <span class="serial-num">#${data.serialNumber || data.orderNumber}</span>
        </div>
        <span class="order-date">${formattedDate}<br/>${formattedTime}</span>
      </div>
      
      <!-- Customer (if exists) -->
      ${data.customerName ? `
      <div class="customer">
        <div class="customer-name">${data.customerName}</div>
        ${data.customerPhone ? `<div class="customer-info">${data.customerPhone}</div>` : ''}
        ${data.customerAddress ? `<div class="customer-info">${data.customerAddress}</div>` : ''}
      </div>
      ` : ''}
      
      <!-- Items -->
      <div class="items">
        <div class="items-header">
          <div class="items-header-left">Item</div>
          <div class="items-header-right">Amount</div>
        </div>
        ${data.items.map(item => `
        <div class="item">
          <div class="item-left">
            <div class="item-name">${item.name}</div>
            <div class="item-qty">×${item.quantity} @ ₹${item.price}</div>
          </div>
          <div class="item-amt">₹${(item.price * item.quantity).toFixed(2)}</div>
        </div>
        `).join('')}
      </div>
      
      <!-- Summary -->
      <div class="summary">
        <div class="sum-row">
          <span>Subtotal</span>
          <span>₹${data.subtotal.toFixed(2)}</span>
        </div>
        ${data.gst && data.gst > 0 ? `
        <div class="sum-row">
          <span>GST 5%</span>
          <span>₹${data.gst.toFixed(2)}</span>
        </div>
        ` : ''}
        ${data.packagingFee && data.packagingFee > 0 ? `
        <div class="sum-row">
          <span>Pkg</span>
          <span>₹${data.packagingFee.toFixed(2)}</span>
        </div>
        ` : ''}
        ${data.deliveryFee && data.deliveryFee > 0 ? `
        <div class="sum-row">
          <span>Delivery</span>
          <span>₹${data.deliveryFee.toFixed(2)}</span>
        </div>
        ` : ''}
      </div>
      
      <!-- Total -->
      <div class="total">
        <span class="total-label">TOTAL</span>
        <span class="total-amt">₹${data.total.toFixed(2)}</span>
      </div>
      
      <!-- Payment Status -->
      ${data.paymentStatus ? `
      <div class="status ${data.paymentStatus === 'paid' ? 'paid' : 'pending'}">
        ${data.paymentStatus === 'paid' ? '✓ PAID' : 'PENDING'}
      </div>
      ` : ''}
      
      <!-- Footer -->
      <div class="footer">
        <div style="margin-bottom: 0.1mm; font-size: 12px; font-weight: 700;">Thank you!</div>
        <div>Powered by <span class="brand">ZLICE</span></div>
        <div style="font-size: 9px; margin-top: 0.1mm; font-weight: 600;">www.zlice.in</div>
      </div>
      
      <div class="spacer"></div>
    </body>
    </html>
  `;
}
