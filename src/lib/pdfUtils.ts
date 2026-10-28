import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { toast } from 'sonner';
import { format } from 'date-fns';
import JsBarcode from 'jsbarcode';
import { PurchaseLog, PurchaseOrder, Business, Branch, Supplier, DailyReport } from '@/src/types';
import { formatAmount } from './currencyUtils';

/**
 * Converts a text or code into a high-contrast Base64 Barcode PNG image via JsBarcode.
 * Can be scanned directly from screen or printed paper using laser/camera barcode scanners.
 */
export function generateBarcodeBase64(
  text: string,
  options?: { height?: number; width?: number; displayValue?: boolean; fontSize?: number }
): string | null {
  if (!text || !String(text).trim()) return null;
  const rawText = String(text).trim();
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, rawText, {
      format: 'CODE128',
      displayValue: options?.displayValue ?? true,
      fontSize: options?.fontSize ?? 11,
      height: options?.height ?? 35,
      width: options?.width ?? 1.8,
      margin: 2,
      background: '#ffffff',
      lineColor: '#000000',
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    try {
      const sanitized = rawText.replace(/[^a-zA-Z0-9_-]/g, '') || '000000';
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, sanitized, {
        format: 'CODE128',
        displayValue: options?.displayValue ?? true,
        fontSize: options?.fontSize ?? 11,
        height: options?.height ?? 35,
        width: options?.width ?? 1.8,
        margin: 2,
        background: '#ffffff',
        lineColor: '#000000',
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
}

/**
 * Generates and downloads a vector PDF for a Purchase Bill with scannable barcode images,
 * item breakdown, payment mode, and professional accounting layout.
 */
export function generateBillPdf({
  log,
  business,
  branch,
  supplier,
  currency = 'OMR',
}: {
  log: PurchaseLog;
  business?: Business | null;
  branch?: Branch | null;
  supplier?: Supplier | null;
  currency?: string;
}): boolean {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    // 1. Business Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(business?.name || 'SHOMEDESK BUSINESS', margin, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // slate-500
    let headerY = 25;
    if (branch) {
      doc.text(`Branch: ${branch.name} (${branch.branchCode || 'BR'}) - ${branch.location || ''}`, margin, headerY);
      headerY += 5;
    }
    if (business?.mobileNumber) {
      doc.text(`Phone: ${business.mobileNumber}`, margin, headerY);
      headerY += 5;
    }

    // 2. Bill Badge & Invoice Number
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(pageWidth - margin - 36, 12, 36, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('PURCHASE BILL', pageWidth - margin - 33, 17.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(`INV #: ${log.invoiceNumber || 'N/A'}`, pageWidth - margin, 26, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const invoiceDate = log.date ? format(new Date(log.date), 'dd MMM yyyy, hh:mm a') : 'N/A';
    doc.text(`Date: ${invoiceDate}`, pageWidth - margin, 31, { align: 'right' });

    // Scannable Barcode for Invoice Number in Header
    const invoiceBarcodeImg = generateBarcodeBase64(log.invoiceNumber || 'INV-001', { height: 26, width: 1.2 });
    if (invoiceBarcodeImg) {
      doc.addImage(invoiceBarcodeImg, 'PNG', pageWidth - margin - 46, 33, 46, 13);
    }

    // Divider Line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, 48, pageWidth - margin, 48);

    // 3. Supplier & Payment Info Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, 51, pageWidth - (margin * 2), 22, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, 51, pageWidth - (margin * 2), 22, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('SUPPLIER DETAILS', margin + 4, 56);
    doc.text('PAYMENT MODE', pageWidth - margin - 45, 56);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(log.supplierName || 'Unknown Supplier', margin + 4, 62);

    doc.setFontSize(10);
    const paymentLabel = log.paymentMode || log.paymentType || 'CASH';
    const bankDetails = log.bankName ? ` (${log.bankName})` : '';
    doc.setTextColor(2, 132, 199); // sky-600
    doc.text(`${paymentLabel}${bankDetails}`, pageWidth - margin - 45, 62);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const supPhone = supplier?.phone ? `Phone: ${supplier.phone}` : '';
    const supAddr = supplier?.address ? ` | Address: ${supplier.address}` : '';
    doc.text(`${supPhone}${supAddr}`, margin + 4, 68);

    // 4. Itemized Breakdown Table with Scannable Barcode Images
    let tableEndY = 78;
    if (log.items && log.items.length > 0) {
      // Pre-generate barcode base64 images for each item
      const itemBarcodes = log.items.map(item => {
        const code = item.barcode || item.productCode;
        return code ? generateBarcodeBase64(code, { height: 25, width: 1.1 }) : null;
      });

      const tableData = log.items.map((item, idx) => [
        String(idx + 1),
        item.name || 'Item',
        '', // Image cell rendered via didDrawCell
        `${Number(item.quantity || 1).toFixed(3)} ${item.unit || 'pcs'}`,
        `${currency} ${formatAmount(item.unitPrice, currency)}`,
        `${currency} ${formatAmount(item.totalPrice || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)), currency)}`,
      ]);

      autoTable(doc, {
        startY: 77,
        head: [['#', 'Product Name', 'Scannable Barcode', 'Qty (Unit)', `Unit Cost (${currency})`, `Total (${currency})`]],
        body: tableData,
        theme: 'striped',
        showHead: 'everyPage',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [51, 65, 85],
          minCellHeight: 14,
          valign: 'middle',
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 42, halign: 'center' },
          3: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
          4: { cellWidth: 28, halign: 'right' },
          5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
        },
        margin: { top: 25, bottom: 25, left: margin, right: margin },
        didDrawPage: (data) => {
          if (data.pageNumber > 1) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(15, 23, 42);
            doc.text(`${business?.name || 'SHOMEDESK'} - Bill #${log.invoiceNumber || 'BILL'} (Cont.)`, margin, 15);
            doc.setDrawColor(226, 232, 240);
            doc.line(margin, 18, pageWidth - margin, 18);
          }
        },
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 2) {
            const barcodeImg = itemBarcodes[data.row.index];
            if (barcodeImg) {
              const imgW = 38;
              const imgH = 11;
              const xPos = data.cell.x + (data.cell.width - imgW) / 2;
              const yPos = data.cell.y + (data.cell.height - imgH) / 2;
              doc.addImage(barcodeImg, 'PNG', xPos, yPos, imgW, imgH);
            } else {
              const code = log.items?.[data.row.index]?.barcode || log.items?.[data.row.index]?.productCode;
              if (code) {
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                doc.text(String(code), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 1, { align: 'center' });
              }
            }
          }
        },
      });

      tableEndY = ((doc as any).lastAutoTable?.finalY || 78) + 6;
    }

    // 5. Financial Calculation Box (3 Decimals)
    const billAmount = Number(log.billAmount || (log as any).amount || 0);
    const paidAmount = Number(log.paidAmount || 0);
    const openingDue = Number(log.openingDue || 0);
    const netDue = Number(log.netDue ?? (openingDue + billAmount - paidAmount));

    const boxWidth = 92;
    const boxX = pageWidth - margin - boxWidth;
    let sumY = tableEndY;
    const pageHeight = doc.internal.pageSize.getHeight();

    // Check page overflow for summary card + signatures (multi-page safe)
    if (sumY + 68 > pageHeight - 15) {
      doc.addPage();
      sumY = 25;
    }

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, sumY, boxWidth, 36, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(boxX, sumY, boxWidth, 36, 2, 2, 'S');

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Previous Due Balance:', boxX + 4, sumY + 7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(225, 29, 72); // rose-600
    doc.text(`${currency} ${formatAmount(openingDue, currency)}`, boxX + boxWidth - 4, sumY + 7, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text('Current Bill Amount:', boxX + 4, sumY + 14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(2, 132, 199); // sky-600
    doc.text(`${currency} ${formatAmount(billAmount, currency)}`, boxX + boxWidth - 4, sumY + 14, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Paid (${paymentLabel}):`, boxX + 4, sumY + 21);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129); // emerald-500
    doc.text(`(-) ${currency} ${formatAmount(paidAmount, currency)}`, boxX + boxWidth - 4, sumY + 21, { align: 'right' });

    doc.setDrawColor(203, 213, 225);
    doc.line(boxX + 2, sumY + 25, boxX + boxWidth - 2, sumY + 25);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Net Due Outstanding:', boxX + 4, sumY + 31);
    doc.setTextColor(netDue > 0 ? 225 : 16, netDue > 0 ? 29 : 185, netDue > 0 ? 72 : 129);
    doc.text(`${currency} ${formatAmount(netDue, currency)}`, boxX + boxWidth - 4, sumY + 31, { align: 'right' });

    // 6. Signatures footer
    const footerY = sumY + 46;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin + 10, footerY, margin + 60, footerY);
    doc.line(pageWidth - margin - 60, footerY, pageWidth - margin - 10, footerY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Received By (Store Manager)', margin + 35, footerY + 5, { align: 'center' });
    doc.text('Authorized Signatory', pageWidth - margin - 35, footerY + 5, { align: 'center' });

    // Multi-page page numbers across all pages
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
      doc.text(`Printed from ShomeDesk Retail ERP • ${invoiceDate}`, margin, pageHeight - 8);
    }

    const filename = `PurchaseBill_${log.invoiceNumber || 'receipt'}.pdf`;
    doc.save(filename);
    toast.success(`Downloaded "${filename}" successfully!`);
    return true;
  } catch (error) {
    console.error('Error generating Bill PDF:', error);
    toast.error('Failed to generate PDF. Please try again.');
    return false;
  }
}

/**
 * Generates and downloads a vector PDF for a Purchase Order with scannable barcode images,
 * item breakdown with units (kg/pcs), and clean layout.
 */
export function generatePoPdf({
  po,
  business,
  branch,
  currency = 'OMR',
}: {
  po: PurchaseOrder;
  business?: Business | null;
  branch?: Branch | null;
  currency?: string;
}): boolean {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text(business?.name || 'SHOMEDESK BUSINESS', margin, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    let headerY = 25;
    if (branch) {
      doc.text(`Branch: ${branch.name} (${branch.branchCode || 'BR'}) - ${branch.location || ''}`, margin, headerY);
      headerY += 5;
    }
    if (business?.mobileNumber) {
      doc.text(`Phone: ${business.mobileNumber}`, margin, headerY);
      headerY += 5;
    }

    // Purchase Order Badge
    doc.setFillColor(79, 70, 229); // indigo-600
    doc.roundedRect(pageWidth - margin - 40, 12, 40, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('PURCHASE ORDER', pageWidth - margin - 37, 17.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(79, 70, 229);
    doc.text(`PO #: ${po.poNumber || 'N/A'}`, pageWidth - margin, 26, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const createdDate = po.createdAt?.toDate ? format(po.createdAt.toDate(), 'dd MMM yyyy') : format(new Date(), 'dd MMM yyyy');
    doc.text(`Date: ${createdDate}`, pageWidth - margin, 31, { align: 'right' });

    // Scannable Barcode for PO Number
    const poBarcodeImg = generateBarcodeBase64(po.poNumber || 'PO-001', { height: 26, width: 1.2 });
    if (poBarcodeImg) {
      doc.addImage(poBarcodeImg, 'PNG', pageWidth - margin - 46, 33, 46, 13);
    }

    // Divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, 48, pageWidth - margin, 48);

    // Vendor Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, 51, pageWidth - (margin * 2), 22, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('VENDOR / SUPPLIER', margin + 4, 56);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(po.supplierName || 'Unknown Supplier', margin + 4, 62);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const supPhone = po.supplierPhone ? `Phone: ${po.supplierPhone}` : '';
    const supAddr = po.supplierAddress ? ` | Address: ${po.supplierAddress}` : '';
    doc.text(`${supPhone}${supAddr}`, margin + 4, 68);

    // Items Table with Barcode Images
    const itemBarcodes = (po.items || []).map(item => {
      const code = item.barcode || item.productCode;
      return code ? generateBarcodeBase64(code, { height: 25, width: 1.1 }) : null;
    });

    const tableData = (po.items || []).map((item, idx) => [
      String(idx + 1),
      item.name || 'Item',
      '', // Rendered by didDrawCell
      `${Number(item.quantity || 1).toFixed(3)} ${item.unit || 'pcs'}`,
      `${currency} ${formatAmount(item.unitPrice, currency)}`,
      `${currency} ${formatAmount(item.totalPrice || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)), currency)}`,
    ]);

    autoTable(doc, {
      startY: 77,
      head: [['#', 'Ordered Product', 'Scannable Barcode', 'Qty (Unit)', `Unit Cost (${currency})`, `Total (${currency})`]],
      body: tableData,
      theme: 'striped',
      showHead: 'everyPage',
      headStyles: {
        fillColor: [79, 70, 229], // indigo-600
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [51, 65, 85],
        minCellHeight: 14,
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 42, halign: 'center' },
        3: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        4: { cellWidth: 28, halign: 'right' },
        5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
      margin: { top: 25, bottom: 25, left: margin, right: margin },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(15, 23, 42);
          doc.text(`${business?.name || 'SHOMEDESK'} - PO #${po.poNumber || 'ORDER'} (Cont.)`, margin, 15);
          doc.setDrawColor(226, 232, 240);
          doc.line(margin, 18, pageWidth - margin, 18);
        }
      },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const barcodeImg = itemBarcodes[data.row.index];
          if (barcodeImg) {
            const imgW = 38;
            const imgH = 11;
            const xPos = data.cell.x + (data.cell.width - imgW) / 2;
            const yPos = data.cell.y + (data.cell.height - imgH) / 2;
            doc.addImage(barcodeImg, 'PNG', xPos, yPos, imgW, imgH);
          } else {
            const code = po.items?.[data.row.index]?.barcode || po.items?.[data.row.index]?.productCode;
            if (code) {
              doc.setFontSize(8);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(100, 116, 139);
              doc.text(String(code), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 1, { align: 'center' });
            }
          }
        }
      },
    });

    const tableEndY = ((doc as any).lastAutoTable?.finalY || 77) + 6;

    // Total Amount Box
    const totalAmount = Number(po.totalAmount || 0);
    const boxWidth = 92;
    const boxX = pageWidth - margin - boxWidth;
    let sumY = tableEndY;
    const pageHeight = doc.internal.pageSize.getHeight();

    // Check page overflow for summary box + signatures
    if (sumY + 60 > pageHeight - 15) {
      doc.addPage();
      sumY = 25;
    }

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, sumY, boxWidth, 20, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(boxX, sumY, boxWidth, 20, 2, 2, 'S');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL PURCHASE ORDER VALUE:', boxX + 4, sumY + 7);

    doc.setFontSize(12);
    doc.setTextColor(79, 70, 229);
    doc.text(`${currency} ${formatAmount(totalAmount, currency)}`, boxX + boxWidth - 4, sumY + 15, { align: 'right' });

    // Footer
    const footerY = sumY + 35;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin + 10, footerY, margin + 60, footerY);
    doc.line(pageWidth - margin - 60, footerY, pageWidth - margin - 10, footerY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Prepared By (Purchaser)', margin + 35, footerY + 5, { align: 'center' });
    doc.text('Supplier Acceptance', pageWidth - margin - 35, footerY + 5, { align: 'center' });

    // Multi-page page numbers across all pages
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
      doc.text(`Printed from ShomeDesk Retail ERP`, margin, pageHeight - 8);
    }

    const filename = `PurchaseOrder_${po.poNumber || 'order'}.pdf`;
    doc.save(filename);
    toast.success(`Downloaded "${filename}" successfully!`);
    return true;
  } catch (error) {
    console.error('Error generating PO PDF:', error);
    toast.error('Failed to generate PO PDF');
    return false;
  }
}

/**
 * Downloads a vector PDF for Purchase Reports
 */
export function generatePurchaseReportPdf({
  logs,
  startDate,
  endDate,
  business,
  branches,
  currency = 'OMR',
}: {
  logs: PurchaseLog[];
  startDate: string;
  endDate: string;
  business?: Business | null;
  branches: Branch[];
  currency?: string;
}): boolean {
  try {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const margin = 14;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(business?.name || 'SHOMEDESK BUSINESS', margin, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Purchase Bills Statement: ${startDate} to ${endDate}`, margin, 24);

    const tableData = logs.map((log, idx) => {
      const branchName = branches.find(b => b.id === log.branchId)?.name || 'Main';
      const bill = Number(log.billAmount || (log as any).amount || 0);
      const paid = Number(log.paidAmount || 0);
      const due = Number(log.netDue || 0);
      return [
        String(idx + 1),
        log.date ? format(new Date(log.date), 'dd/MM/yyyy') : '-',
        log.invoiceNumber || '-',
        log.supplierName || 'Unknown',
        branchName,
        log.paymentMode || log.paymentType || 'CASH',
        `${currency} ${formatAmount(bill, currency)}`,
        `${currency} ${formatAmount(paid, currency)}`,
        `${currency} ${formatAmount(due, currency)}`,
      ];
    });

    autoTable(doc, {
      startY: 28,
      head: [['#', 'Date', 'Invoice #', 'Supplier', 'Branch', 'Payment', `Bill (${currency})`, `Paid (${currency})`, `Net Due (${currency})`]],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [16, 185, 129],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [51, 65, 85],
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        6: { halign: 'right', fontStyle: 'bold' },
        7: { halign: 'right' },
        8: { halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
    });

    const filename = `Purchase_Report_${startDate}_to_${endDate}.pdf`;
    doc.save(filename);
    toast.success(`Downloaded "${filename}" successfully!`);
    return true;
  } catch (error) {
    console.error('Error generating report PDF:', error);
    toast.error('Failed to generate report PDF');
    return false;
  }
}

/**
 * Mathematically and visually converts OKLCH color strings into standard sRGB / RGBA.
 * Prevents html2canvas from crashing on CSS Color Level 4 (oklch, oklab, color-mix)
 * injected by Tailwind CSS v4 or modern browser computed styles.
 */
export function convertOklchToRgb(str: string): string {
  if (!str || typeof str !== 'string') return str;
  const trimmed = str.trim();

  // 1. Try browser canvas context normalization first if in browser
  if (typeof document !== 'undefined') {
    try {
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 1;
      testCanvas.height = 1;
      const ctx = testCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillStyle = trimmed;
        const normalized = ctx.fillStyle;
        if (normalized && !normalized.includes('oklch') && !normalized.includes('oklab')) {
          return normalized;
        }
      }
    } catch {}
  }

  // 2. Exact mathematical conversion: OKLCH -> OKLab -> Linear sRGB -> Standard sRGB
  try {
    const match = trimmed.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+deg|[\d.]+rad|[\d.]+turn|[\d.]+)?(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
    if (!match) return '#334155';

    const L = match[1].endsWith('%') ? parseFloat(match[1]) / 100 : parseFloat(match[1]);
    const C = match[2].endsWith('%') ? parseFloat(match[2]) / 100 : parseFloat(match[2]);
    const hStr = match[3] || '0';
    let H = 0;
    if (hStr.endsWith('deg')) H = parseFloat(hStr);
    else if (hStr.endsWith('rad')) H = (parseFloat(hStr) * 180) / Math.PI;
    else if (hStr.endsWith('turn')) H = parseFloat(hStr) * 360;
    else H = parseFloat(hStr) || 0;

    const A = match[4] ? (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1;

    const hRad = (H * Math.PI) / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const rLinear = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const toSrgb = (c: number) => {
      const clamped = Math.max(0, Math.min(1, c));
      return clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    };

    const r = Math.round(toSrgb(rLinear) * 255);
    const g = Math.round(toSrgb(gLinear) * 255);
    const bVal = Math.round(toSrgb(bLinear) * 255);

    if (A < 1) {
      return `rgba(${r}, ${g}, ${bVal}, ${A.toFixed(2)})`;
    }
    return `rgb(${r}, ${g}, ${bVal})`;
  } catch {
    return '#334155';
  }
}

/**
 * Sanitizes CSS text by replacing unsupported modern color expressions (oklch, oklab, color-mix, hwb)
 * with standard RGB/RGBA representations.
 */
export function sanitizeCssColors(css: string): string {
  if (!css || typeof css !== 'string') return css;
  return css
    .replace(/oklch\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, (m) => convertOklchToRgb(m))
    .replace(/oklab\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '#64748b')
    .replace(/color-mix\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '#3b82f6')
    .replace(/hwb\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '#64748b')
    .replace(/lab\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '#64748b')
    .replace(/lch\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '#64748b');
}

/**
 * Downloads any DOM element as a crisp vector/canvas A4 PDF without popup blockers or print dialogs.
 * Fully sanitized against Tailwind v4 OKLCH color errors.
 */
export async function downloadElementAsPdf(
  elementIdOrEl: string | HTMLElement, 
  filename: string, 
  landscape: boolean = false
): Promise<boolean> {
  const el = typeof elementIdOrEl === 'string' ? document.getElementById(elementIdOrEl) : elementIdOrEl;
  if (!el) {
    toast.error('Could not find document element to export');
    return false;
  }
  const toastId = toast.loading('Generating PDF...');
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: el.scrollWidth || 1024,
      onclone: (clonedDoc) => {
        // 1. Sanitize all <style> elements in clonedDoc
        try {
          const styles = clonedDoc.querySelectorAll('style');
          styles.forEach((style) => {
            if (style.textContent && /oklch|oklab|color-mix|hwb|lab|lch/i.test(style.textContent)) {
              style.textContent = sanitizeCssColors(style.textContent);
            }
          });
        } catch (e) {
          console.warn('Style sanitization warning:', e);
        }

        // 2. Walk all cloned elements and replace any oklch in inline styles or computed styles
        try {
          const allNodes = clonedDoc.querySelectorAll('*');
          allNodes.forEach((node) => {
            if (node instanceof (clonedDoc.defaultView?.HTMLElement || HTMLElement)) {
              // Sanitize inline style attribute
              const styleAttr = node.getAttribute('style');
              if (styleAttr && /oklch|oklab|color-mix|hwb|lab|lch/i.test(styleAttr)) {
                node.setAttribute('style', sanitizeCssColors(styleAttr));
              }

              // Overwrite computed color properties with valid RGB
              try {
                const win = clonedDoc.defaultView || window;
                const comp = win.getComputedStyle(node);
                const colorProps = [
                  'color',
                  'backgroundColor',
                  'borderColor',
                  'borderTopColor',
                  'borderBottomColor',
                  'borderLeftColor',
                  'borderRightColor',
                  'outlineColor',
                  'fill',
                  'stroke',
                ] as const;

                for (const p of colorProps) {
                  const val = (comp as any)[p];
                  if (typeof val === 'string' && /oklch|oklab|color-mix|hwb|lab|lch/i.test(val)) {
                    (node.style as any)[p] = convertOklchToRgb(val);
                  }
                }
              } catch {}
            }
          });
        } catch (e) {
          console.warn('Node color sanitization warning:', e);
        }
      },
    });

    const imgData = canvas.toDataURL('image/png');
    const orientation = landscape ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = landscape ? 297 : 210;
    const pageHeight = landscape ? 210 : 297;
    const margin = 10;
    const maxImgWidth = pageWidth - (margin * 2);
    const maxImgHeight = pageHeight - (margin * 2);

    const imgWidth = maxImgWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= maxImgHeight) {
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
    } else {
      let heightLeft = imgHeight;
      let position = margin;
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= maxImgHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + margin;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
        heightLeft -= maxImgHeight;
      }
    }

    const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    pdf.save(safeFilename);
    toast.success(`Downloaded "${safeFilename}" successfully!`, { id: toastId });
    return true;
  } catch (err: any) {
    console.error('PDF generation error (handled):', err);
    // If html2canvas fails, fallback to structured print styling
    try {
      const pdf = new jsPDF({
        orientation: landscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
      });
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text(filename.replace(/_/g, ' ').replace('.pdf', ''), 14, 20);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Exported on ${format(new Date(), 'dd MMM yyyy, hh:mm a')}`, 14, 28);
      
      const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      pdf.save(safeFilename);
      toast.success(`Downloaded "${safeFilename}"!`, { id: toastId });
      return true;
    } catch {
      toast.error('Failed to generate PDF file', { id: toastId });
      return false;
    }
  }
}

/**
 * Triggers PDF download for the element (replaces legacy window.print)
 */
export function triggerDirectPrint(elementId?: string, title: string = 'Document'): boolean {
  if (elementId) {
    downloadElementAsPdf(elementId, `${title}.pdf`);
    return true;
  }
  toast.info('Downloading PDF document...');
  return true;
}

export function printElement(elementId: string, title: string = 'Document'): boolean {
  downloadElementAsPdf(elementId, `${title}.pdf`);
  return true;
}

/**
 * Generates and downloads a clean, professional vector PDF for a Daily Report (Closing Statement)
 * with strict P&L accounting (Gross Profit = Total Sales - COGS, Net Profit = Gross Profit - Operating Expenses),
 * liquidity cash/bank flow, and itemized expenses.
 */
export function generateDailyReportPdf({
  report,
  business,
  branch,
  currency = 'OMR',
}: {
  report: DailyReport;
  business?: Business | null;
  branch?: Branch | null;
  currency?: string;
}): boolean {
  const toastId = toast.loading('Generating Daily Report PDF...');
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    // 1. Header with Emerald Accent Ribbon
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setFillColor(16, 185, 129); // emerald-500
    doc.rect(0, 27, pageWidth, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(business?.name || 'SHOMEDESK RETAIL ERP', margin, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(203, 213, 225);
    let headerSub = `Branch / Store: ${branch?.name || 'Main Branch'} (${branch?.branchCode || 'BR'}) - ${branch?.location || 'Central'}`;
    doc.text(headerSub, margin, 19);
    if (business?.mobileNumber) {
      doc.text(`Contact: ${business.mobileNumber}`, margin, 24);
    }

    // Badge
    doc.setFillColor(16, 185, 129); // emerald-500
    doc.roundedRect(pageWidth - margin - 48, 8, 48, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('DAILY CLOSING Z-REPORT', pageWidth - margin - 45, 13.5);

    const reportDateStr = report.date ? format(new Date(report.date), 'EEEE, MMMM dd, yyyy') : format(new Date(), 'yyyy-MM-dd');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`${reportDateStr}`, pageWidth - margin, 21, { align: 'right' });

    // 2. Calculations
    const cashSale = Number(report.cashSale) || 0;
    const cardSale = Number(report.cardSale) || 0;
    const onlineSale = Number(report.onlineSale) || 0;
    const bankSale = Number(report.bankSale) || 0;
    const totalSale = report.totalSale !== undefined 
      ? Number(report.totalSale) 
      : (cashSale + (cardSale > 0 || onlineSale > 0 ? (cardSale + onlineSale) : bankSale));
    const cogs = Number(report.cogs) || 0;
    const grossProfit = report.grossProfit !== undefined ? Number(report.grossProfit) : (totalSale - cogs);
    const grossMargin = totalSale > 0 ? ((grossProfit / totalSale) * 100).toFixed(1) : '0.0';

    const cashExpense = Number(report.cashExpense) || 0;
    const bankExpense = Number(report.bankExpense) || 0;
    const cardExpense = Number(report.cardExpense) || 0;
    const totalExpense = report.totalExpense !== undefined ? Number(report.totalExpense) : (cashExpense + bankExpense + cardExpense);
    const netProfit = report.netProfit !== undefined ? Number(report.netProfit) : (grossProfit - totalExpense);
    const netMargin = totalSale > 0 ? ((netProfit / totalSale) * 100).toFixed(1) : '0.0';

    const openingCash = Number(report.openingCash) || 0;
    const openingBank = Number(report.openingBank) || 0;
    const bankToCash = Number(report.bankToCash) || 0;
    const cashToBank = Number(report.cashToBank) || 0;
    const closingCash = Number(report.closingCash) || 0;
    const closingBank = Number(report.closingBank) || 0;
    const totalLiquidity = closingCash + closingBank;

    // 3. Top 4 Colorful Stat Highlight Cards
    const cardW = (pageWidth - (margin * 2) - 9) / 4;
    const cardY = 32;
    const cardH = 18;

    // Card 1: Total Sales (Emerald)
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(margin, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, cardY, cardW, cardH, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(5, 150, 105);
    doc.text('TOTAL SALES REVENUE', margin + 3, cardY + 5);
    doc.setFontSize(10.5);
    doc.setTextColor(6, 95, 70);
    doc.text(`${currency} ${formatAmount(totalSale, currency)}`, margin + 3, cardY + 13);

    // Card 2: Cost of Goods (COGS - Slate)
    const card2X = margin + cardW + 3;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(card2X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(card2X, cardY, cardW, cardH, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('COST OF GOODS (COGS)', card2X + 3, cardY + 5);
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`${currency} ${formatAmount(cogs, currency)}`, card2X + 3, cardY + 13);

    // Card 3: Operating Expenses (Rose)
    const card3X = card2X + cardW + 3;
    doc.setFillColor(255, 241, 242);
    doc.roundedRect(card3X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(244, 63, 94);
    doc.roundedRect(card3X, cardY, cardW, cardH, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(225, 29, 72);
    doc.text('TOTAL EXPENSES', card3X + 3, cardY + 5);
    doc.setFontSize(10.5);
    doc.setTextColor(159, 18, 57);
    doc.text(`${currency} ${formatAmount(totalExpense, currency)}`, card3X + 3, cardY + 13);

    // Card 4: Net Profit (Indigo/Emerald)
    const card4X = card3X + cardW + 3;
    const isProfitable = netProfit >= 0;
    doc.setFillColor(isProfitable ? 238 : 255, isProfitable ? 242 : 241, isProfitable ? 255 : 242);
    doc.roundedRect(card4X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(isProfitable ? 99 : 244, isProfitable ? 102 : 63, isProfitable ? 241 : 94);
    doc.roundedRect(card4X, cardY, cardW, cardH, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(isProfitable ? 79 : 225, isProfitable ? 70 : 29, isProfitable ? 229 : 72);
    doc.text(`NET PROFIT (${netMargin}%)`, card4X + 3, cardY + 5);
    doc.setFontSize(10.5);
    doc.setTextColor(isProfitable ? 55 : 159, isProfitable ? 48 : 18, isProfitable ? 163 : 57);
    doc.text(`${currency} ${formatAmount(netProfit, currency)}`, card4X + 3, cardY + 13);

    const summaryData = [
      ['SALES & REVENUE', 'Cash Sales (Drawer)', `${currency} ${formatAmount(cashSale, currency)}`],
      ['SALES & REVENUE', 'Card Sales (POS Machine)', `${currency} ${formatAmount(cardSale || (bankSale > 0 && onlineSale === 0 ? bankSale : 0), currency)}`],
      ['SALES & REVENUE', 'Online Bank Sales', `${currency} ${formatAmount(onlineSale, currency)}`],
      ['SALES & REVENUE', 'TOTAL GROSS REVENUE', `${currency} ${formatAmount(totalSale, currency)}`],
      ['PROFIT & LOSS (P&L)', 'Cost of Goods Sold (COGS)', `${currency} ${formatAmount(cogs, currency)}`],
      ['PROFIT & LOSS (P&L)', 'GROSS PROFIT (Revenue - COGS)', `${currency} ${formatAmount(grossProfit, currency)} (${grossMargin}%)`],
      ['PROFIT & LOSS (P&L)', 'Daily Cash Expenses', `${currency} ${formatAmount(cashExpense, currency)}`],
      ['PROFIT & LOSS (P&L)', 'Daily Bank Expenses', `${currency} ${formatAmount(bankExpense, currency)}`],
      ['PROFIT & LOSS (P&L)', 'TOTAL OPERATING EXPENSES', `${currency} ${formatAmount(totalExpense, currency)}`],
      ['PROFIT & LOSS (P&L)', 'NET PROFIT (Gross - Expenses)', `${currency} ${formatAmount(netProfit, currency)} (${netMargin}%)`],
      ['LIQUIDITY & BALANCES', 'Opening Cash', `${currency} ${formatAmount(openingCash, currency)}`],
      ['LIQUIDITY & BALANCES', 'Opening Bank', `${currency} ${formatAmount(openingBank, currency)}`],
      ['LIQUIDITY & BALANCES', 'Cash to Bank (Deposit)', `${currency} ${formatAmount(cashToBank, currency)}`],
      ['LIQUIDITY & BALANCES', 'Bank to Cash (Withdrawal)', `${currency} ${formatAmount(bankToCash, currency)}`],
      ['LIQUIDITY & BALANCES', 'CLOSING CASH IN DRAWER', `${currency} ${formatAmount(closingCash, currency)}`],
      ['LIQUIDITY & BALANCES', 'CLOSING BANK BALANCE', `${currency} ${formatAmount(closingBank, currency)}`],
      ['LIQUIDITY & BALANCES', 'TOTAL CLOSING LIQUIDITY', `${currency} ${formatAmount(totalLiquidity, currency)}`],
    ];

    autoTable(doc, {
      startY: 54,
      head: [['Category', 'Accounting Metric', 'Amount']],
      body: summaryData,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 58, 138], // Royal Blue
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: 'bold', textColor: [71, 85, 105] },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 45, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const metric = String(data.row.raw?.[1] || '');
          if (metric === 'TOTAL GROSS REVENUE') {
            data.cell.styles.fillColor = [236, 253, 245];
            data.cell.styles.textColor = [6, 95, 70];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric.startsWith('GROSS PROFIT')) {
            data.cell.styles.fillColor = [240, 253, 250];
            data.cell.styles.textColor = [15, 118, 110];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric === 'TOTAL OPERATING EXPENSES') {
            data.cell.styles.fillColor = [255, 241, 242];
            data.cell.styles.textColor = [190, 18, 60];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric.startsWith('NET PROFIT')) {
            data.cell.styles.fillColor = [238, 242, 255];
            data.cell.styles.textColor = [37, 99, 235];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric === 'CLOSING CASH IN DRAWER') {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [146, 64, 14];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric === 'CLOSING BANK BALANCE') {
            data.cell.styles.fillColor = [224, 242, 254];
            data.cell.styles.textColor = [3, 105, 161];
            data.cell.styles.fontStyle = 'bold';
          } else if (metric === 'TOTAL CLOSING LIQUIDITY') {
            data.cell.styles.fillColor = [243, 232, 255];
            data.cell.styles.textColor = [107, 33, 168];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    let currentY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 10 : 160;

    // Itemized Expenses if present
    if (report.expenseItems && report.expenseItems.length > 0) {
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('Itemized Operating Expenses Breakdown', margin, currentY);
      currentY += 4;

      const expenseRows = report.expenseItems.map((e, idx) => [
        String(idx + 1),
        e.category || 'General',
        e.paymentType.toUpperCase(),
        e.bankName || '-',
        e.note || '-',
        `${currency} ${formatAmount(Number(e.amount) || 0, currency)}`,
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [['#', 'Category', 'Mode', 'Bank Account', 'Note / Description', `Amount (${currency})`]],
        body: expenseRows,
        theme: 'striped',
        headStyles: {
          fillColor: [51, 65, 85],
          textColor: [255, 255, 255],
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
        },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 35, fontStyle: 'bold' },
          2: { cellWidth: 20 },
          3: { cellWidth: 35 },
          4: { cellWidth: 'auto' },
          5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: margin, right: margin },
      });

      currentY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
    }

    // Notes
    if (report.note) {
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 16, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('MANAGER REMARKS:', margin + 4, currentY + 5);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text(report.note, margin + 4, currentY + 11);
      currentY += 22;
    }

    // Signatures
    if (currentY > 260) {
      doc.addPage();
      currentY = 30;
    } else {
      currentY = Math.max(currentY + 10, 255);
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(margin, currentY, margin + 60, currentY);
    doc.line(pageWidth - margin - 60, currentY, pageWidth - margin, currentY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Prepared by: Store Manager / Cashier', margin, currentY + 5);
    doc.text('Verified by: Authorized Auditor / Owner', pageWidth - margin, currentY + 5, { align: 'right' });

    // Multi-page page numbers across all pages
    const pageHeight = doc.internal.pageSize.getHeight();
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
      doc.text(`Printed from ShomeDesk ERP • ${reportDateStr}`, margin, pageHeight - 8);
    }

    const dateSlug = report.date ? format(new Date(report.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    const branchSlug = branch?.name ? `_${branch.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    const filename = `Daily_Closing_Statement${branchSlug}_${dateSlug}.pdf`;
    doc.save(filename);
    toast.success(`Downloaded "${filename}" successfully!`, { id: toastId });
    return true;
  } catch (err: any) {
    console.error('Failed to generate daily report PDF:', err);
    toast.error('Failed to generate PDF document', { id: toastId });
    return false;
  }
}

/**
 * Generates and downloads a clean, professional vector PDF for Business Reports
 * (P&L Statement, Daily Summary, Monthly Trends) using pure jsPDF + autoTable.
 * Completely immune to DOM parsing and CSS color errors (e.g. OKLCH).
 */
export function generateBusinessReportPdf({
  activeTab,
  business,
  branch,
  currency = 'OMR',
  dateRange,
  pnlCalculations,
  dailyReportsData = [],
  monthlyTrendsData = [],
  branches = [],
}: {
  activeTab: string;
  business?: Business | null;
  branch?: Branch | null;
  currency?: string;
  dateRange: { start: string; end: string };
  pnlCalculations?: {
    totalSales: number;
    cashSales: number;
    cardSales: number;
    bankSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent?: number;
    grossMargin?: string | number;
    cashExpenses: number;
    bankExpenses: number;
    totalOperatingExpenses: number;
    netProfit: number;
    netMarginPercent?: number;
    netMargin?: string | number;
  };
  dailyReportsData?: DailyReport[];
  monthlyTrendsData?: any[];
  branches?: Branch[];
}): boolean {
  const toastId = toast.loading('Generating Business Report PDF...');
  try {
    const isLandscape = activeTab === 'daily' || activeTab === 'monthly';
    const doc = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    // 1. Header with Colorful Ribbon
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 26, 'F');
    doc.setFillColor(37, 99, 235); // royal blue ribbon
    doc.rect(0, 25, pageWidth, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(business?.name || 'SHOMEDESK BUSINESS', margin, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(203, 213, 225);
    let sub = `Period: ${dateRange.start} to ${dateRange.end} | Currency: ${currency} (0.000)`;
    if (branch) sub += ` | Branch: ${branch.name}`;
    doc.text(sub, margin, 19);

    // Badge
    const tabTitles: Record<string, string> = {
      pnl: 'PROFIT & LOSS STATEMENT (P&L)',
      daily: 'DAILY CLOSING REPORTS SUMMARY',
      monthly: 'MONTHLY TRENDS & CASH FLOW',
      expenses: 'OPERATING EXPENSES BREAKDOWN',
      purchases: 'PURCHASE RECORDS & DUE',
      payment_mode: 'PAYMENT MODE ALLOCATION',
      store_wise: 'STORE-WISE PERFORMANCE',
      transactions: 'FINANCIAL TRANSACTIONS',
    };
    const reportTitle = tabTitles[activeTab] || 'BUSINESS REPORT';
    doc.setFillColor(37, 99, 235); // blue-600
    const badgeWidth = doc.getTextWidth(reportTitle) + 10;
    doc.roundedRect(pageWidth - margin - badgeWidth, 9, badgeWidth, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text(reportTitle, pageWidth - margin - badgeWidth + 5, 14.5);

    let startY = 33;

    if (activeTab === 'pnl' && pnlCalculations) {
      // 4 Colorful Stat Summary Cards for P&L
      const cardW = (pageWidth - (margin * 2) - 9) / 4;
      const cardH = 17;

      // Card 1: Revenue (Emerald)
      doc.setFillColor(236, 253, 245);
      doc.roundedRect(margin, startY, cardW, cardH, 2, 2, 'F');
      doc.setDrawColor(16, 185, 129);
      doc.roundedRect(margin, startY, cardW, cardH, 2, 2, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(5, 150, 105);
      doc.text('TOTAL REVENUE', margin + 3, startY + 5);
      doc.setFontSize(10);
      doc.setTextColor(6, 95, 70);
      doc.text(`${currency} ${formatAmount(pnlCalculations.totalSales, currency)}`, margin + 3, startY + 12);

      // Card 2: Gross Profit (Teal)
      const c2X = margin + cardW + 3;
      doc.setFillColor(240, 253, 250);
      doc.roundedRect(c2X, startY, cardW, cardH, 2, 2, 'F');
      doc.setDrawColor(20, 184, 166);
      doc.roundedRect(c2X, startY, cardW, cardH, 2, 2, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(13, 148, 136);
      doc.text(`GROSS PROFIT (${pnlCalculations.grossMarginPercent ?? pnlCalculations.grossMargin ?? 0}%)`, c2X + 3, startY + 5);
      doc.setFontSize(10);
      doc.setTextColor(15, 118, 110);
      doc.text(`${currency} ${formatAmount(pnlCalculations.grossProfit, currency)}`, c2X + 3, startY + 12);

      // Card 3: Expenses (Rose)
      const c3X = c2X + cardW + 3;
      doc.setFillColor(255, 241, 242);
      doc.roundedRect(c3X, startY, cardW, cardH, 2, 2, 'F');
      doc.setDrawColor(244, 63, 94);
      doc.roundedRect(c3X, startY, cardW, cardH, 2, 2, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(225, 29, 72);
      doc.text('TOTAL EXPENSES', c3X + 3, startY + 5);
      doc.setFontSize(10);
      doc.setTextColor(159, 18, 57);
      doc.text(`${currency} ${formatAmount(pnlCalculations.totalOperatingExpenses, currency)}`, c3X + 3, startY + 12);

      // Card 4: Net Profit (Indigo)
      const c4X = c3X + cardW + 3;
      const isProfitable = pnlCalculations.netProfit >= 0;
      doc.setFillColor(isProfitable ? 238 : 255, isProfitable ? 242 : 241, isProfitable ? 255 : 242);
      doc.roundedRect(c4X, startY, cardW, cardH, 2, 2, 'F');
      doc.setDrawColor(isProfitable ? 99 : 244, isProfitable ? 102 : 63, isProfitable ? 241 : 94);
      doc.roundedRect(c4X, startY, cardW, cardH, 2, 2, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(isProfitable ? 79 : 225, isProfitable ? 70 : 29, isProfitable ? 229 : 72);
      doc.text(`NET PROFIT (${pnlCalculations.netMarginPercent ?? pnlCalculations.netMargin ?? 0}%)`, c4X + 3, startY + 5);
      doc.setFontSize(10);
      doc.setTextColor(isProfitable ? 55 : 159, isProfitable ? 48 : 18, isProfitable ? 163 : 57);
      doc.text(`${currency} ${formatAmount(pnlCalculations.netProfit, currency)}`, c4X + 3, startY + 12);

      startY = 55;

      const pnlRows = [
        ['1. REVENUE & SALES', 'Cash Sales (Physical Register)', `${currency} ${formatAmount(pnlCalculations.cashSales, currency)}`],
        ['', 'Card Sales (POS Machine / EDC)', `${currency} ${formatAmount(pnlCalculations.cardSales, currency)}`],
        ['', 'Online Bank Sales / Transfer', `${currency} ${formatAmount(pnlCalculations.bankSales, currency)}`],
        ['', 'TOTAL GROSS REVENUE', `${currency} ${formatAmount(pnlCalculations.totalSales, currency)}`],
        ['2. COST OF GOODS SOLD (COGS)', 'Product Purchase Cost of Goods Sold', `(${currency} ${formatAmount(pnlCalculations.cogs, currency)})`],
        ['3. GROSS PROFITABILITY', 'GROSS PROFIT (SALES - COGS)', `${currency} ${formatAmount(pnlCalculations.grossProfit, currency)}`],
        ['', 'Gross Profit Margin %', `${pnlCalculations.grossMarginPercent ?? pnlCalculations.grossMargin ?? 0}%`],
        ['4. OPERATING EXPENSES', 'Daily Cash Operating Expenses', `${currency} ${formatAmount(pnlCalculations.cashExpenses, currency)}`],
        ['', 'Bank / Online Operating Expenses', `${currency} ${formatAmount(pnlCalculations.bankExpenses, currency)}`],
        ['', 'TOTAL OPERATING EXPENSES', `${currency} ${formatAmount(pnlCalculations.totalOperatingExpenses, currency)}`],
        ['5. NET PROFITABILITY', 'NET PROFIT (GROSS PROFIT - EXPENSES)', `${currency} ${formatAmount(pnlCalculations.netProfit, currency)}`],
        ['', 'Net Profit Margin %', `${pnlCalculations.netMarginPercent ?? pnlCalculations.netMargin ?? 0}%`],
      ];

      autoTable(doc, {
        startY,
        head: [['Section', 'Metric Description', `Amount (${currency})`]],
        body: pnlRows,
        theme: 'striped',
        showHead: 'everyPage',
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8.5 },
        columnStyles: {
          0: { cellWidth: 55, fontStyle: 'bold', textColor: [71, 85, 105] },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' },
        },
        margin: { top: 25, bottom: 20, left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const desc = String(data.row.raw?.[1] || '');
            if (desc === 'TOTAL GROSS REVENUE') {
              data.cell.styles.fillColor = [236, 253, 245];
              data.cell.styles.textColor = [6, 95, 70];
              data.cell.styles.fontStyle = 'bold';
            } else if (desc.startsWith('GROSS PROFIT')) {
              data.cell.styles.fillColor = [240, 253, 250];
              data.cell.styles.textColor = [15, 118, 110];
              data.cell.styles.fontStyle = 'bold';
            } else if (desc === 'TOTAL OPERATING EXPENSES') {
              data.cell.styles.fillColor = [255, 241, 242];
              data.cell.styles.textColor = [190, 18, 60];
              data.cell.styles.fontStyle = 'bold';
            } else if (desc.startsWith('NET PROFIT')) {
              data.cell.styles.fillColor = [238, 242, 255];
              data.cell.styles.textColor = [37, 99, 235];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        },
      });
    } else if (activeTab === 'daily') {
      const dailyRows = dailyReportsData.map((r, i) => {
        const branchObj = branches.find(b => b.id === r.branchId);
        const cashS = Number(r.cashSale) || 0;
        const bankS = Number(r.bankSale) || 0;
        const totalS = cashS + bankS;
        const cashE = Number(r.cashExpense) || 0;
        const bankE = Number(r.bankExpense) || 0;
        const totalE = cashE + bankE;
        return [
          r.date ? format(new Date(r.date), 'yyyy-MM-dd') : `Day ${i + 1}`,
          branchObj?.name || 'Main',
          formatAmount(cashS, currency),
          formatAmount(bankS, currency),
          formatAmount(totalS, currency),
          formatAmount(cashE, currency),
          formatAmount(bankE, currency),
          formatAmount(totalE, currency),
          formatAmount(Number(r.closingCash) || 0, currency),
          formatAmount(Number(r.closingBank) || 0, currency),
        ];
      });

      autoTable(doc, {
        startY,
        head: [['Date', 'Branch', 'Cash Sale', 'Bank Sale', 'Total Sale', 'Cash Exp', 'Bank Exp', 'Total Exp', 'Closing Cash', 'Closing Bank']],
        body: dailyRows,
        theme: 'striped',
        showHead: 'everyPage',
        headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 7.5, halign: 'right' },
        columnStyles: {
          0: { halign: 'left', cellWidth: 24, fontStyle: 'bold' },
          1: { halign: 'left', cellWidth: 26 },
        },
        margin: { top: 25, bottom: 20, left: margin, right: margin },
      });
    } else if (activeTab === 'monthly') {
      const monthlyRows = monthlyTrendsData.map(m => [
        m.label,
        formatAmount(m.totalSales, currency),
        formatAmount(m.cogs, currency),
        formatAmount(m.grossProfit, currency),
        formatAmount(m.operatingExpenses, currency),
        formatAmount(m.netProfit, currency),
        formatAmount(m.cashFlow, currency),
      ]);

      autoTable(doc, {
        startY,
        head: [['Month / Period', `Total Sales (${currency})`, `COGS (${currency})`, `Gross Profit (${currency})`, `Expenses (${currency})`, `Net Profit (${currency})`, `Cash Flow (${currency})`]],
        body: monthlyRows,
        theme: 'striped',
        showHead: 'everyPage',
        headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        bodyStyles: { fontSize: 8, halign: 'right' },
        columnStyles: {
          0: { halign: 'left', cellWidth: 40, fontStyle: 'bold' },
        },
        margin: { top: 25, bottom: 20, left: margin, right: margin },
      });
    }

    // Multi-page page numbers
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
      doc.text(`Printed from ShomeDesk Business • ${format(new Date(), 'yyyy-MM-dd')}`, margin, pageHeight - 8);
    }

    const safeFilename = `${activeTab.toUpperCase()}_Report_${dateRange.start}_to_${dateRange.end}.pdf`;
    doc.save(safeFilename);
    toast.success(`Downloaded "${safeFilename}" successfully!`, { id: toastId });
    return true;
  } catch (err: any) {
    console.error('Failed to generate business report vector PDF:', err);
    toast.error('Failed to generate business report PDF', { id: toastId });
    return false;
  }
}

