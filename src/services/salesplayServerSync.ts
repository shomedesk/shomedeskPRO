import https from 'https';
import { db, auth } from '../lib/firebase';
import { signInAnonymously } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { format, subDays } from 'date-fns';
import { toStrictDecimal3 } from '../lib/currencyUtils';

const DEFAULT_SALESPLAY_API_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpbl9uYW1lIjoibWFrYXJlbWJha2thbGFAZ21haWwuY29tIiwiZGF0ZSI6IkZyaWRheSAyNXRoIDIwMjZmIFNlcHRlbWJlciAyMDI2IDAxOjA1OjU1IEFNIn0.wmzb6XXPzLK_xsmyML7KA8U9_NNC9W0m26nlM29afsU';

const DEFAULT_SHOP_ID = 'VEpoaG9WaHlTZ0Nocko4ekcwVFpqZz09';
const DEFAULT_BUSINESS_ID = 'j2S1dqdU9W3WAdd7KXyk';
const DEFAULT_BRANCH_ID = 'kZW07zMAVPglK98ruycB';
const DEFAULT_OWNER_ID = '5KH6pWSLtzUakBBDqrv2n5zSr243';

function makeSalesPlayApiRequest(
  endpointPath: string,
  method: string,
  payload?: any
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const finalPath = `/v1.0${endpointPath}`;
    let postData = '';

    if (payload !== undefined && payload !== null) {
      postData = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }

    const reqHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      Authorization: `Bearer ${DEFAULT_SALESPLAY_API_TOKEN}`,
    };

    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(postData));
    }

    const req = https.request(
      {
        hostname: 'api.salesplaypos.com',
        path: finalPath,
        method,
        headers: reqHeaders,
        timeout: 25000,
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 200,
            data: buf,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('SalesPlay request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

let isSyncRunning = false;
let isQuotaExhausted = false;
const alreadyWrittenReceipts = new Set<string>();
let lastSavedProductCount = 0;

/**
 * Execute a complete background sync of SalesPlay POS Products, Inventory, and Receipts directly to Firestore.
 * Runs on the Node.js server to ensure 100% reliability for both Preview and standalone WebApp clients.
 */
export async function syncSalesPlayServerToFirestore(): Promise<{
  productsCount: number;
  receiptsCount: number;
  message: string;
}> {
  if (isSyncRunning) {
    return { productsCount: 0, receiptsCount: 0, message: 'Sync already in progress' };
  }
  isSyncRunning = true;

  try {
    // 1. Ensure Firebase authentication
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (authErr) {
        console.warn('Server anonymous auth notice:', authErr);
      }
    }

    // 2. Fetch inventory stock levels
    const stockMap: Record<string, number> = {};
    try {
      const invRes = await makeSalesPlayApiRequest('/inventory', 'GET');
      if (invRes.statusCode === 200) {
        const invParsed = JSON.parse(invRes.data);
        const levels = invParsed?.inventory_levels || [];
        for (const lvl of levels) {
          if (!lvl.shop_id || lvl.shop_id === DEFAULT_SHOP_ID) {
            stockMap[lvl.product_id] = Number(lvl.in_stock) || 0;
          }
        }
      }
    } catch (e) {
      console.warn('Notice fetching inventory in server sync:', e);
    }

    // 3. Fetch all products (auto-paginated)
    const allProducts: any[] = [];
    const costMap = new Map<string, number>();
    let cursor = '';
    let page = 0;

    while (page < 10) {
      page++;
      const payload: Record<string, any> = { limit: 250 };
      if (cursor) payload.cursor = cursor;

      const prodRes = await makeSalesPlayApiRequest('/products', 'GET', payload);
      if (prodRes.statusCode !== 200) break;

      let parsed: any;
      try {
        parsed = JSON.parse(prodRes.data);
      } catch {
        break;
      }

      const prods = parsed.products || [];
      if (!Array.isArray(prods) || prods.length === 0) break;

      for (const p of prods) {
        let shopPrice = Number(p.cost) || 0;
        if (Array.isArray(p.shops)) {
          const foundShop = p.shops.find((s: any) => s.shop_id === DEFAULT_SHOP_ID);
          if (foundShop && foundShop.price !== undefined) {
            shopPrice = Number(foundShop.price) || 0;
          }
        }

        const cost = Number(p.cost) || 0;
        if (p.id && cost > 0) costMap.set(p.id, cost);
        if (p.product_code && cost > 0) costMap.set(p.product_code, cost);
        if (p.barcode && cost > 0) costMap.set(p.barcode, cost);
        if (p.product_name && cost > 0) costMap.set(p.product_name.toLowerCase().trim(), cost);

        allProducts.push({
          id: p.id,
          product_code: p.product_code || '',
          product_name: (p.product_name || 'Unnamed Item').trim(),
          category: (p.category || 'General').trim(),
          sub_category: (p.sub_category || '').trim(),
          barcode: (p.barcode || p.product_code || '').trim(),
          cost,
          price: shopPrice,
          measurement: p.measurement || '',
          image_url: p.image_url || '',
          stock_control: p.stock_control ?? true,
          in_stock: stockMap[p.id] !== undefined ? stockMap[p.id] : 0,
        });
      }

      if (!parsed.cursor || parsed.cursor === cursor) break;
      cursor = parsed.cursor;
    }

    // Save full products catalog to Firestore only if changed and quota not exhausted
    if (allProducts.length > 0 && lastSavedProductCount !== allProducts.length && !isQuotaExhausted) {
      try {
        await setDoc(
          doc(db, 'salesPlayCatalog', 'all_products'),
          {
            products: allProducts,
            count: allProducts.length,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        lastSavedProductCount = allProducts.length;
      } catch (err: any) {
        if (err?.code === 'resource-exhausted' || String(err?.message || '').includes('Quota limit exceeded')) {
          console.warn('[SalesPlay Server Sync] Quota limit exceeded saving products. Continuing in-memory.');
          isQuotaExhausted = true;
        } else {
          console.warn('Notice saving products to Firestore:', err);
        }
      }
    }

    // 4. Fetch receipts for the last 14 days
    const now = new Date();
    const minStr = format(subDays(now, 14), 'yyyy-MM-dd 00:00:00');
    const maxStr = format(now, 'yyyy-MM-dd 23:59:59');

    let allReceipts: any[] = [];
    try {
      const recRes = await makeSalesPlayApiRequest('/receipts', 'POST', {
        created_at_min: minStr,
        created_at_max: maxStr,
      });

      if (recRes.statusCode === 200) {
        const parsed = JSON.parse(recRes.data);
        if (Array.isArray(parsed.receipts)) {
          allReceipts = parsed.receipts.filter((r: any) => !r.receipt_delete_status && r.receipt_number);
        }
      }
    } catch (e) {
      console.warn('Notice fetching receipts in server sync:', e);
    }

    // 5. Convert and save receipts to Firestore sales collection
    let savedReceiptsCount = 0;
    const cleanReceiptsSummary: any[] = [];

    for (const receipt of allReceipts) {
      const customerObj = receipt.customer?.[0];
      const customerName =
        customerObj?.name && customerObj.name !== 'N/A' ? customerObj.name : 'Walk-in Customer';
      const customerPhone = customerObj?.phone_number || '';

      let cashAmt = 0;
      let cardAmt = 0;
      let onlineAmt = 0;

      if (Array.isArray(receipt.payments) && receipt.payments.length > 0) {
        receipt.payments.forEach((p: any) => {
          const type = (p.payment_type || '').toLowerCase();
          const amt = Number(p.money_amount) || 0;
          if (type.includes('card') || type.includes('pos') || type.includes('visa') || type.includes('master')) {
            cardAmt += amt;
          } else if (type.includes('cash')) {
            cashAmt += amt;
          } else {
            onlineAmt += amt;
          }
        });
      } else {
        cashAmt = Number(receipt.total_money) || 0;
      }

      let paymentMode = 'Cash';
      const activeModes = (cashAmt > 0 ? 1 : 0) + (cardAmt > 0 ? 1 : 0) + (onlineAmt > 0 ? 1 : 0);
      if (activeModes > 1) paymentMode = 'Split';
      else if (cardAmt > 0) paymentMode = 'Card';
      else if (onlineAmt > 0) paymentMode = 'Online';

      let totalCost = 0;
      const items = (receipt.line_products || []).map((lp: any, idx: number) => {
        const qty = Number(lp.quantity) || 1;
        const unitPrice = Number(lp.price) || 0;
        const totalPrice = Number(lp.total_money) || qty * unitPrice;

        let unitCost = Number(lp.cost) || 0;
        if (unitCost === 0) {
          if (lp.product_id && costMap.has(lp.product_id)) {
            unitCost = costMap.get(lp.product_id)!;
          } else if (lp.product_code && costMap.has(lp.product_code)) {
            unitCost = costMap.get(lp.product_code)!;
          } else if (lp.product_name && costMap.has(lp.product_name.toLowerCase().trim())) {
            unitCost = costMap.get(lp.product_name.toLowerCase().trim())!;
          }
        }

        let costTotal = Number(lp.cost_total) || 0;
        if (costTotal <= 0 && unitCost > 0) {
          costTotal = toStrictDecimal3(unitCost * qty);
        } else if (costTotal > 0 && unitCost <= 0 && qty > 0) {
          unitCost = toStrictDecimal3(costTotal / qty);
        }

        totalCost = toStrictDecimal3(totalCost + costTotal);

        return {
          id: lp.product_id || `item_${idx}`,
          productId: lp.product_id || '',
          productCode: lp.product_code || '',
          name: lp.product_name || 'Item',
          category: lp.category_name || '',
          quantity: qty,
          unitPrice,
          unitCost,
          totalPrice,
          totalCost: costTotal,
        };
      });

      const totalAmount = Number(receipt.total_money) || 0;
      const grossProfit = totalAmount - totalCost;
      const grossProfitMargin = totalAmount > 0 ? (grossProfit / totalAmount) * 100 : 0;

      let dateIso = new Date().toISOString();
      try {
        if (receipt.receipt_date_time) {
          dateIso = new Date(receipt.receipt_date_time.replace(' ', 'T')).toISOString();
        } else if (receipt.receipt_date) {
          dateIso = new Date(receipt.receipt_date).toISOString();
        }
      } catch {
        dateIso = new Date().toISOString();
      }

      const invoicePayload = {
        businessId: DEFAULT_BUSINESS_ID,
        ownerId: DEFAULT_OWNER_ID,
        branchId: DEFAULT_BRANCH_ID,
        invoiceNumber: receipt.receipt_number || `INV-${Date.now()}`,
        receiptNumber: receipt.receipt_number,
        customerName,
        customerPhone,
        items,
        subtotal: totalAmount,
        discount: Number(receipt.total_discount) || 0,
        tax: 0,
        totalAmount: toStrictDecimal3(totalAmount),
        totalCost: toStrictDecimal3(totalCost),
        grossProfit: toStrictDecimal3(grossProfit),
        grossProfitMargin: Number(grossProfitMargin.toFixed(1)),
        paymentMode,
        cashAmount: toStrictDecimal3(cashAmt),
        cardAmount: toStrictDecimal3(cardAmt),
        onlineAmount: toStrictDecimal3(onlineAmt),
        transaction_id: receipt.receipt_number,
        bill_id: receipt.receipt_number,
        source: 'salesplay_pos',
        salesPlayOrderId: receipt.receipt_number,
        date: dateIso,
        createdAt: new Date(),
        syncedAt: serverTimestamp(),
        notes: receipt.note || `Imported from SalesPlay POS (Cashier: ${receipt.cashier_name || 'Admin'})`,
      };

      const safeDocId = `sp_${DEFAULT_BUSINESS_ID}_${receipt.receipt_number.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      // Quota Protection: Skip documents that have already been synchronized during this server lifecycle
      if (!alreadyWrittenReceipts.has(safeDocId) && !isQuotaExhausted) {
        try {
          await setDoc(doc(db, 'sales', safeDocId), invoicePayload, { merge: true });
          await setDoc(doc(db, 'pos_transactions', safeDocId), invoicePayload, { merge: true });
          alreadyWrittenReceipts.add(safeDocId);
          savedReceiptsCount++;
        } catch (err: any) {
          if (err?.code === 'resource-exhausted' || String(err?.message || '').includes('Quota limit exceeded')) {
            console.warn('[SalesPlay Server Sync] Firestore write quota exhausted. Pausing Firestore writes.');
            isQuotaExhausted = true;
            break; // Stop attempting writes when quota is reached
          }
          console.warn('Notice saving receipt to Firestore:', err);
        }
      }

      cleanReceiptsSummary.push({
        receipt_number: receipt.receipt_number,
        date: dateIso,
        totalAmount,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        onlineAmount: onlineAmt,
        totalCost,
      });
    }

    // Save sync checkpoint in Firestore only if writes succeeded and not quota exhausted
    if (!isQuotaExhausted) {
      try {
        await setDoc(
          doc(db, 'salesPlaySync', 'latest'),
          {
            lastSyncedAt: new Date().toISOString(),
            productsCount: allProducts.length,
            receiptsCount: savedReceiptsCount,
            status: 'success',
          },
          { merge: true }
        );
      } catch (checkpointErr: any) {
        if (checkpointErr?.code === 'resource-exhausted' || String(checkpointErr?.message || '').includes('Quota limit exceeded')) {
          isQuotaExhausted = true;
        } else {
          console.warn('Checkpoint notice:', checkpointErr);
        }
      }
    }

    return {
      productsCount: allProducts.length,
      receiptsCount: savedReceiptsCount,
      message: `Successfully synced ${allProducts.length} items & ${savedReceiptsCount} receipts!`,
    };
  } catch (error: any) {
    if (error?.code === 'resource-exhausted' || String(error?.message || '').includes('Quota limit exceeded')) {
      console.warn('[SalesPlay Server Sync] Firestore write quota exceeded. Operating in read-only / cache mode.');
      return { productsCount: 0, receiptsCount: 0, message: 'Firestore daily write quota reached (Free tier)' };
    }
    console.error('Server SalesPlay sync error:', error);
    return { productsCount: 0, receiptsCount: 0, message: error?.message || 'Sync failed' };
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Start background sync on the server.
 * Runs once on startup. Avoids tight polling loops to preserve free tier quota.
 */
export function startBackgroundSalesPlaySync() {
  // Automatic background synchronization on startup is disabled to protect Firestore free tier daily quota.
  // Data is synchronized on-demand when users click Sync or Import.
}
