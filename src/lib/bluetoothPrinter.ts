/**
 * Bluetooth 58mm / 80mm ESC/POS Thermal Printer Driver for Browser WebApps.
 * 
 * Supports:
 * 1. Web Bluetooth API (navigator.bluetooth) - Direct wireless printing to mini Bluetooth thermal POS printers
 * 2. 58mm ESC/POS byte generator (32 characters per line, optimized for 58mm/384 dots thermal printers)
 * 3. 1-Click Browser Direct Thermal Print (Formatted @page size: 58mm auto) without downloading files
 * 4. Automatic reconnection, device state tracking, and test slip printing
 */

import { toast } from 'sonner';
import { format } from 'date-fns';
import { PurchaseOrder, PurchaseLog, Business, Branch } from '@/src/types';
import { formatAmount } from './currencyUtils';

// Common Bluetooth Printer Service UUIDs used by 58mm & 80mm ESC/POS thermal printers
const BLUETOOTH_PRINT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard POS Printer Service
  'e7810a71-73ae-49f6-8c33-4704ef273e95', // Common Chinese/MPT POS Service
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART service
  '0000ff00-0000-1000-8000-00805f9b34fb', // Custom POS vendor service 1
  '0000fff0-0000-1000-8000-00805f9b34fb', // Custom POS vendor service 2
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent/WeChat POS
  '0000ae00-0000-1000-8000-00805f9b34fb', // Custom vendor service 3
];

// In-memory Bluetooth state
interface BluetoothPrinterState {
  device: any | null;
  server: any | null;
  characteristic: any | null;
  deviceName: string | null;
  isConnected: boolean;
  paperWidth: '58mm' | '80mm';
}

const state: BluetoothPrinterState = {
  device: null,
  server: null,
  characteristic: null,
  deviceName: null,
  isConnected: false,
  paperWidth: '58mm',
};

// Listeners for UI state reactivity
type StateListener = (isConnected: boolean, deviceName: string | null) => void;
const listeners: Set<StateListener> = new Set();

export function subscribePrinterState(listener: StateListener): () => void {
  listeners.add(listener);
  listener(state.isConnected, state.deviceName);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach(cb => {
    try {
      cb(state.isConnected, state.deviceName);
    } catch {
      // ignore
    }
  });
}

/**
 * Checks if Web Bluetooth API is supported by the current browser environment
 */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Returns current printer connection status
 */
export function getPrinterStatus(): { isConnected: boolean; deviceName: string | null; paperWidth: '58mm' | '80mm' } {
  return {
    isConnected: state.isConnected,
    deviceName: state.deviceName,
    paperWidth: state.paperWidth,
  };
}

/**
 * Connect to a 58mm / 80mm Bluetooth Thermal Printer
 */
export async function connectBluetoothPrinter(): Promise<boolean> {
  if (!isBluetoothSupported()) {
    toast.error('Web Bluetooth is not supported in this browser. Please use Chrome/Edge or 1-Click Direct Print.');
    return false;
  }

  const toastId = toast.loading('Searching for Bluetooth Thermal Printers...');

  try {
    const navAny = navigator as any;
    
    // Request Bluetooth Device
    const device = await navAny.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLUETOOTH_PRINT_SERVICES,
    });

    if (!device) {
      toast.dismiss(toastId);
      return false;
    }

    toast.loading(`Connecting to "${device.name || '58mm Printer'}"...`, { id: toastId });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await device.gatt.connect();

    // Find writable characteristic across primary services
    let writableChar: any = null;

    // Search optional services first
    for (const serviceUuid of BLUETOOTH_PRINT_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();
        for (const c of characteristics) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            writableChar = c;
            break;
          }
        }
        if (writableChar) break;
      } catch {
        // service not present on this device, continue
      }
    }

    // Fallback: search all available services if not found
    if (!writableChar) {
      try {
        const services = await server.getPrimaryServices();
        for (const s of services) {
          try {
            const characteristics = await s.getCharacteristics();
            for (const c of characteristics) {
              if (c.properties.write || c.properties.writeWithoutResponse) {
                writableChar = c;
                break;
              }
            }
            if (writableChar) break;
          } catch {
            // continue
          }
        }
      } catch {
        // ignore
      }
    }

    if (!writableChar) {
      toast.error('Connected to device, but no ESC/POS print channel found. Ensure it is a thermal receipt printer.', { id: toastId });
      device.gatt.disconnect();
      return false;
    }

    state.device = device;
    state.server = server;
    state.characteristic = writableChar;
    state.deviceName = device.name || '58mm Bluetooth Printer';
    state.isConnected = true;

    notifyListeners();
    toast.success(`Connected to "${state.deviceName}" (58mm Ready)!`, { id: toastId });
    return true;
  } catch (err: any) {
    console.error('Bluetooth connection failed:', err);
    if (err.name === 'NotFoundError') {
      toast.dismiss(toastId);
    } else if (err.name === 'SecurityError') {
      toast.error('Bluetooth blocked by browser security. Open app in a new tab or use 1-Click Direct Print.', { id: toastId });
    } else {
      toast.error(`Could not connect: ${err.message || 'Device refused connection'}`, { id: toastId });
    }
    return false;
  }
}

/**
 * Disconnect from the current Bluetooth printer
 */
export function disconnectBluetoothPrinter(): void {
  if (state.device && state.device.gatt?.connected) {
    try {
      state.device.gatt.disconnect();
    } catch {
      // ignore
    }
  }
  onDisconnected();
  toast.info('Bluetooth printer disconnected.');
}

function onDisconnected() {
  state.isConnected = false;
  state.device = null;
  state.server = null;
  state.characteristic = null;
  state.deviceName = null;
  notifyListeners();
}

/**
 * Sends raw bytes in chunks (64 bytes each with 15ms interval) to prevent printer buffer overrun
 */
async function sendRawBytes(bytes: Uint8Array): Promise<boolean> {
  if (!state.characteristic || !state.isConnected) {
    throw new Error('Bluetooth printer is not connected');
  }

  const chunkSize = 64;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    if (state.characteristic.writeValueWithoutResponse) {
      await state.characteristic.writeValueWithoutResponse(chunk);
    } else {
      await state.characteristic.writeValue(chunk);
    }
    // Tiny delay between chunks for 58mm mini printer buffer
    await new Promise(res => setTimeout(res, 18));
  }
  return true;
}

// ==========================================
// 58mm ESC/POS BYTE COMMAND GENERATOR (32 COLS)
// ==========================================

class EscPosBuilder {
  private buffer: number[] = [];
  private maxCols: number = 32; // standard 58mm width in font A

  constructor(maxCols: number = 32) {
    this.maxCols = maxCols;
    this.init();
  }

  // Initialize printer
  init(): this {
    this.buffer.push(0x1B, 0x40); // ESC @
    return this;
  }

  // Alignment: 'left' | 'center' | 'right'
  align(align: 'left' | 'center' | 'right'): this {
    const code = align === 'center' ? 0x01 : align === 'right' ? 0x02 : 0x00;
    this.buffer.push(0x1B, 0x61, code); // ESC a n
    return this;
  }

  bold(enable: boolean = true): this {
    this.buffer.push(0x1B, 0x45, enable ? 0x01 : 0x00); // ESC E n
    return this;
  }

  // Font size: 'normal' | 'double_height' | 'double_size'
  fontSize(size: 'normal' | 'double_height' | 'double_size'): this {
    let n = 0x00;
    if (size === 'double_height') n = 0x01;
    if (size === 'double_size') n = 0x11;
    this.buffer.push(0x1D, 0x21, n); // GS ! n
    return this;
  }

  // Text line with automatic newline
  text(str: string): this {
    const sanitized = this.sanitizeText(str);
    for (let i = 0; i < sanitized.length; i++) {
      this.buffer.push(sanitized.charCodeAt(i) & 0xFF);
    }
    this.buffer.push(0x0A); // LF
    return this;
  }

  // Horizontal dashed divider line (32 chars)
  divider(char: string = '-'): this {
    this.align('left');
    this.bold(false);
    this.fontSize('normal');
    this.text(char.repeat(this.maxCols));
    return this;
  }

  // Two columns: Left aligned and Right aligned on the same 32-col line
  twoCol(left: string, right: string, bold: boolean = false): this {
    this.align('left');
    this.bold(bold);
    this.fontSize('normal');

    const cleanLeft = this.sanitizeText(left);
    const cleanRight = this.sanitizeText(right);
    const spaceCount = Math.max(1, this.maxCols - cleanLeft.length - cleanRight.length);
    const line = cleanLeft + ' '.repeat(spaceCount) + cleanRight;
    this.text(line.slice(0, this.maxCols));
    return this;
  }

  // Three columns: Item (16), Qty (6), Total (10)
  threeCol(col1: string, col2: string, col3: string): this {
    this.align('left');
    this.bold(false);
    this.fontSize('normal');

    const c1 = this.sanitizeText(col1).padEnd(16).slice(0, 16);
    const c2 = this.sanitizeText(col2).padStart(6).slice(0, 6);
    const c3 = this.sanitizeText(col3).padStart(10).slice(0, 10);
    this.text(c1 + c2 + c3);
    return this;
  }

  // Feed lines and cut paper
  cut(): this {
    this.buffer.push(0x0A, 0x0A, 0x0A, 0x0A); // 4 line feeds
    this.buffer.push(0x1D, 0x56, 0x00); // GS V 0 (cut)
    return this;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private sanitizeText(str: string): string {
    if (!str) return '';
    // Strip non-ASCII or replace tabs
    return String(str)
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
  }
}

/**
 * Prints a test receipt to verify 58mm Bluetooth printer alignment and paper feed
 */
export async function printTestSlipViaBluetooth(): Promise<boolean> {
  if (!state.isConnected) {
    const connected = await connectBluetoothPrinter();
    if (!connected) return false;
  }

  const toastId = toast.loading('Sending test slip to 58mm printer...');
  try {
    const builder = new EscPosBuilder(32);
    builder
      .align('center')
      .bold(true)
      .fontSize('double_size')
      .text('SHOMEDESK POS')
      .fontSize('normal')
      .bold(false)
      .text('58mm Bluetooth Printer')
      .text('Status: READY & CONNECTED')
      .divider('=')
      .twoCol('Date:', format(new Date(), 'dd/MM/yyyy'))
      .twoCol('Time:', format(new Date(), 'hh:mm:ss a'))
      .twoCol('Printer Width:', '58 mm (32 cols)')
      .divider('-')
      .align('center')
      .bold(true)
      .text('BLUETOOTH PRINT OK!')
      .bold(false)
      .text('Retail ERP POS System')
      .cut();

    await sendRawBytes(builder.getBytes());
    toast.success('Test slip printed successfully!', { id: toastId });
    return true;
  } catch (err: any) {
    console.error('Test print failed:', err);
    toast.error('Print failed: ' + (err.message || 'Connection lost'), { id: toastId });
    return false;
  }
}

/**
 * Prints a Purchase Order directly over Bluetooth in 58mm thermal receipt layout
 */
export async function printPoViaBluetooth({
  po,
  business,
  branch,
  currency = 'OMR',
}: {
  po: PurchaseOrder;
  business?: Business | null;
  branch?: Branch | null;
  currency?: string;
}): Promise<boolean> {
  if (!state.isConnected) {
    const connected = await connectBluetoothPrinter();
    if (!connected) return false;
  }

  const toastId = toast.loading('Printing 58mm PO slip over Bluetooth...');
  try {
    const builder = new EscPosBuilder(32);

    // 1. Business Header
    builder
      .align('center')
      .bold(true)
      .fontSize('double_height')
      .text(business?.name || 'SHOMEDESK POS')
      .fontSize('normal')
      .bold(false);

    if (branch?.name) {
      builder.text(`Branch: ${branch.name}`);
    }
    if (business?.mobileNumber) {
      builder.text(`Tel: ${business.mobileNumber}`);
    }

    builder.divider('=');

    // 2. Order Header
    builder
      .align('center')
      .bold(true)
      .text('PURCHASE ORDER SLIP')
      .text(`PO #: ${po.poNumber || 'N/A'}`)
      .bold(false)
      .text(`Date: ${po.createdAt?.toDate ? format(po.createdAt.toDate(), 'dd/MM/yy hh:mm a') : format(new Date(), 'dd/MM/yy hh:mm a')}`)
      .divider('-');

    // 3. Supplier Details
    builder
      .align('left')
      .twoCol('Supplier:', po.supplierName || 'Unknown', true);
    if (po.supplierPhone) {
      builder.twoCol('Phone:', po.supplierPhone);
    }

    builder.divider('-');

    // 4. Items Table Header
    builder.threeCol('Item', 'Qty', `Total (${currency})`);
    builder.divider('-');

    // 5. Items List
    const items = po.items || [];
    items.forEach((item, idx) => {
      const isPack = item.orderMode === 'pack' && item.packCount;
      const itemName = `${idx + 1}. ${item.name || 'Item'}`;
      builder.align('left').bold(true).text(itemName.slice(0, 32)).bold(false);

      const qtyStr = isPack ? `${item.packCount}pk` : `${item.quantity || 1}pcs`;
      const rateStr = isPack && item.packPrice ? `@${formatAmount(item.packPrice, currency)}` : `@${formatAmount(item.unitPrice, currency)}`;
      const totalStr = formatAmount(item.totalPrice || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)), currency);

      builder.threeCol(rateStr, qtyStr, totalStr);

      if (isPack && item.piecesPerPack) {
        builder.text(`  [${item.packCount} Pk x ${item.piecesPerPack} = ${item.quantity} pcs]`);
      }
      if (item.barcode) {
        builder.text(`  BC: ${item.barcode}`);
      }
    });

    builder.divider('=');

    // 6. Summary Totals
    const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    builder
      .twoCol(`Total Items (${items.length}):`, `${totalQty} units`)
      .bold(true)
      .fontSize('double_height')
      .twoCol('TOTAL:', `${currency} ${formatAmount(po.totalAmount || 0, currency)}`, true)
      .fontSize('normal')
      .bold(false);

    if (po.notes) {
      builder.divider('-');
      builder.text(`Notes: ${po.notes}`);
    }

    // 7. Footer & Cut
    builder
      .divider('-')
      .align('center')
      .text('*** END OF PURCHASE ORDER ***')
      .text(`Printed: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`)
      .cut();

    await sendRawBytes(builder.getBytes());
    toast.success('PO slip printed directly to 58mm Bluetooth printer!', { id: toastId });
    return true;
  } catch (err: any) {
    console.error('Bluetooth PO print failed:', err);
    toast.error('Print failed: ' + (err.message || 'Lost connection to printer'), { id: toastId });
    return false;
  }
}

/**
 * 1-Click Direct Browser Print for 58mm Thermal Printers (No file download).
 * Formats an isolated hidden iframe with exact @page size: 58mm auto,
 * so the system print dialog sends directly to the 58mm roll printer.
 */
export function directPrint58mmHtml({
  title,
  htmlBody,
}: {
  title: string;
  htmlBody: string;
}): boolean {
  try {
    const existingIframe = document.getElementById('thermal-58mm-print-frame');
    if (existingIframe) {
      existingIframe.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'thermal-58mm-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      toast.error('Unable to create print frame');
      return false;
    }

    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          @page {
            size: 58mm auto;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            width: 54mm;
            max-width: 54mm;
            margin: 0 auto;
            padding: 2mm 1mm;
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 10px;
            line-height: 1.25;
            color: #000;
            background: #fff;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .title { font-size: 13px; font-weight: bold; margin-bottom: 2px; }
          .subtitle { font-size: 9px; margin-bottom: 3px; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .divider-solid { border-top: 1px solid #000; margin: 4px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 9.5px; }
          .col-left { text-align: left; }
          .col-right { text-align: right; font-weight: bold; }
          .item-row { margin-bottom: 3px; }
          .item-name { font-weight: bold; font-size: 9.5px; word-break: break-word; }
          .item-meta { display: flex; justify-content: space-between; font-size: 8.5px; color: #111; }
          .total-box { margin-top: 4px; font-size: 12px; font-weight: bold; }
          .barcode-box { text-align: center; margin: 4px 0; }
          .barcode-box img { max-width: 48mm; height: 16mm; }
        </style>
      </head>
      <body>
        ${htmlBody}
      </body>
      </html>
    `;

    doc.open();
    doc.write(fullHtml);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 60000); // cleanup after 1 min
      } catch (e) {
        console.error('Direct print trigger error:', e);
      }
    }, 300);

    return true;
  } catch (err) {
    console.error('Direct 58mm print error:', err);
    toast.error('Direct print failed. You can download the 58mm PDF.');
    return false;
  }
}
