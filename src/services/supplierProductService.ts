import { db } from '@/src/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { SupplierProduct, PurchaseOrderItem, PurchaseLog, SalesPlayProduct } from '@/src/types';

/**
 * Service to manage Supplier Product Profiles / Catalogs.
 * Tracks all products associated with a specific supplier with actual SalesPlay categories,
 * historical purchase costs, and enables one-click auto-import into PO and Bill entries.
 */

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Generate a deterministic and safe Firestore document ID for a supplier's product
export function getSupplierProductDocId(supplierId: string, item: { productCode?: string; productId?: string; barcode?: string; name: string }): string {
  const rawId = (item.productId || item.productCode || item.barcode || item.name || 'item').trim();
  const clean = rawId.replace(/[\/\s.#$[\]]/g, '_').slice(0, 50);
  const hash = simpleHash(rawId);
  return `sp_${supplierId}_${clean}_${hash}`;
}

/**
 * Fetch all products associated with a supplier's profile.
 * If the profile has no products yet, it automatically scans previous purchase logs
 * for this supplier to discover and populate past purchased products.
 */
export async function getSupplierProducts(
  supplierId: string,
  businessId?: string,
  autoDiscoverHistory = true
): Promise<SupplierProduct[]> {
  if (!supplierId) return [];

  try {
    const q = query(
      collection(db, 'supplierProducts'),
      where('supplierId', '==', supplierId)
    );
    const snap = await getDocs(q);
    let products = snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierProduct));

    // If no products found in supplierProducts yet, auto-discover from past purchase logs
    if (products.length === 0 && autoDiscoverHistory) {
      const discoveredCount = await syncSupplierProductsFromHistory(supplierId, businessId);
      if (discoveredCount > 0) {
        const refreshedSnap = await getDocs(q);
        products = refreshedSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierProduct));
      }
    }

    // Sort alphabetically by category, then by product name
    products.sort((a, b) => {
      const catCompare = (a.category || '').localeCompare(b.category || '');
      if (catCompare !== 0) return catCompare;
      return (a.productName || '').localeCompare(b.productName || '');
    });

    return products;
  } catch (err) {
    console.warn('Error fetching supplier products:', err);
    return [];
  }
}

/**
 * Automatically update or add products to the Supplier's Product Profile
 * whenever a Bill or Purchase Order is logged/saved.
 */
export async function saveSupplierProductsFromBill(
  supplierId: string,
  supplierName: string,
  businessId: string,
  items: PurchaseOrderItem[],
  billDate: string
): Promise<void> {
  if (!supplierId || !items || items.length === 0) return;

  try {
    const updatePromises = items.map(async (item) => {
      if (!item.name || !item.name.trim()) return;

      const docId = getSupplierProductDocId(supplierId, item);
      const docRef = doc(db, 'supplierProducts', docId);

      const payload: Partial<SupplierProduct> = {
        id: docId,
        supplierId,
        supplierName: supplierName || 'Supplier',
        businessId: businessId || '',
        productName: item.name.trim(),
        category: (item.category || 'General').trim(),
        unit: item.unit || 'pcs',
        lastCost: Number(item.unitPrice) || 0,
        lastPurchaseDate: billDate || new Date().toISOString(),
        updatedAt: serverTimestamp(),
      };

      if (item.productId) payload.productId = item.productId;
      if (item.productCode) payload.productCode = item.productCode;
      if (item.barcode) payload.barcode = item.barcode.trim();
      if (item.salesPrice) payload.salesPrice = Number(item.salesPrice) || 0;

      await setDoc(docRef, payload, { merge: true });
    });

    await Promise.all(updatePromises);
  } catch (err) {
    console.warn('Error saving supplier products from bill:', err);
  }
}

/**
 * Add or link a SalesPlay product directly into a Supplier's Product Profile
 */
export async function linkProductToSupplier(
  supplierId: string,
  supplierName: string,
  businessId: string,
  product: SalesPlayProduct,
  customCost?: number
): Promise<void> {
  if (!supplierId || !product) return;

  const docId = getSupplierProductDocId(supplierId, {
    productId: product.id,
    productCode: product.product_code,
    barcode: product.barcode,
    name: product.product_name,
  });

  const payload: SupplierProduct = {
    id: docId,
    supplierId,
    supplierName,
    businessId: businessId || '',
    productId: product.id || '',
    productCode: product.product_code || '',
    productName: product.product_name || 'Product',
    barcode: (product.barcode || '').trim(),
    category: (product.category || 'General').trim(),
    subCategory: (product.sub_category || '').trim(),
    unit: product.is_weight_item ? 'kg' : (product.measurement || 'pcs'),
    lastCost: customCost !== undefined ? customCost : (Number(product.cost) || 0),
    salesPrice: Number(product.price) || 0,
    lastPurchaseDate: new Date().toISOString(),
    timesPurchased: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'supplierProducts', docId), payload, { merge: true });
}

/**
 * Add a custom/manual product directly into a Supplier's Product Profile (even without SalesPlay sync)
 */
export async function addManualSupplierProduct(
  supplierId: string,
  supplierName: string,
  businessId: string,
  data: {
    productName: string;
    category?: string;
    barcode?: string;
    unit?: string;
    cost: number;
    salesPrice?: number;
    productCode?: string;
  }
): Promise<SupplierProduct> {
  const docId = getSupplierProductDocId(supplierId, {
    name: data.productName,
    barcode: data.barcode,
    productCode: data.productCode,
  });

  const payload: SupplierProduct = {
    id: docId,
    supplierId,
    supplierName: supplierName || 'Supplier',
    businessId: businessId || '',
    productName: data.productName.trim(),
    category: (data.category || 'General').trim(),
    barcode: (data.barcode || '').trim(),
    productCode: (data.productCode || '').trim(),
    unit: (data.unit || 'pcs').trim(),
    lastCost: Number(data.cost) || 0,
    salesPrice: Number(data.salesPrice) || 0,
    lastPurchaseDate: new Date().toISOString(),
    timesPurchased: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'supplierProducts', docId), payload, { merge: true });
  return payload;
}

/**
 * Remove a product from a supplier's catalog profile
 */
export async function removeProductFromSupplier(supplierProductId: string): Promise<void> {
  if (!supplierProductId) return;
  await deleteDoc(doc(db, 'supplierProducts', supplierProductId));
}

/**
 * Scans historical purchaseLogs and purchaseOrders for this supplier and aggregates all purchased items
 * into the supplier's product profile catalog.
 */
export async function syncSupplierProductsFromHistory(
  supplierId: string,
  businessId?: string
): Promise<number> {
  if (!supplierId) return 0;

  try {
    let totalDiscovered = 0;
    const productMap = new Map<string, { item: PurchaseOrderItem; date: string; supplierName: string; bizId: string }>();

    // 1. Scan Purchase Logs
    try {
      const qLogs = query(
        collection(db, 'purchaseLogs'),
        where('supplierId', '==', supplierId)
      );
      const snapLogs = await getDocs(qLogs);
      snapLogs.docs.forEach(docSnap => {
        const log = docSnap.data() as PurchaseLog;
        if (log.items && Array.isArray(log.items)) {
          log.items.forEach(item => {
            if (!item.name || !item.name.trim()) return;
            const key = (item.productCode || item.productId || item.barcode || item.name).trim().toLowerCase();
            const itemDate = log.date || (log.createdAt?.toDate ? log.createdAt.toDate().toISOString() : '');
            const existing = productMap.get(key);
            if (!existing || new Date(itemDate).getTime() > new Date(existing.date).getTime()) {
              productMap.set(key, {
                item,
                date: itemDate,
                supplierName: log.supplierName || '',
                bizId: log.businessId || businessId || ''
              });
            }
          });
        }
      });
    } catch (logErr) {
      console.warn('Notice scanning purchaseLogs for history:', logErr);
    }

    // 2. Scan Purchase Orders
    try {
      const qPOs = query(
        collection(db, 'purchaseOrders'),
        where('supplierId', '==', supplierId)
      );
      const snapPOs = await getDocs(qPOs);
      snapPOs.docs.forEach(docSnap => {
        const po = docSnap.data() as any;
        if (po.items && Array.isArray(po.items)) {
          po.items.forEach((item: PurchaseOrderItem) => {
            if (!item.name || !item.name.trim()) return;
            const key = (item.productCode || item.productId || item.barcode || item.name).trim().toLowerCase();
            const poDate = po.expectedDate || (po.createdAt?.toDate ? po.createdAt.toDate().toISOString() : '');
            const existing = productMap.get(key);
            if (!existing || new Date(poDate).getTime() > new Date(existing.date).getTime()) {
              productMap.set(key, {
                item,
                date: poDate,
                supplierName: po.supplierName || '',
                bizId: po.businessId || businessId || ''
              });
            }
          });
        }
      });
    } catch (poErr) {
      console.warn('Notice scanning purchaseOrders for history:', poErr);
    }

    if (productMap.size === 0) return 0;

    const entries = Array.from(productMap.values());
    for (const entry of entries) {
      const docId = getSupplierProductDocId(supplierId, entry.item);
      const payload: SupplierProduct = {
        id: docId,
        supplierId,
        supplierName: entry.supplierName || 'Supplier',
        businessId: entry.bizId || businessId || '',
        productId: entry.item.productId || '',
        productCode: entry.item.productCode || '',
        productName: entry.item.name.trim(),
        barcode: (entry.item.barcode || '').trim(),
        category: (entry.item.category || 'General').trim(),
        unit: entry.item.unit || 'pcs',
        lastCost: Number(entry.item.unitPrice) || 0,
        salesPrice: Number(entry.item.salesPrice) || 0,
        lastPurchaseDate: entry.date || new Date().toISOString(),
        timesPurchased: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'supplierProducts', docId), payload, { merge: true });
      totalDiscovered++;
    }

    return totalDiscovered;
  } catch (err) {
    console.warn('Error syncing supplier products from history:', err);
    return 0;
  }
}
