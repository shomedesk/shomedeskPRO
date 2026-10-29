import { db } from '@/src/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { ProductPackConfig, PurchaseOrderItem, SalesPlayProduct } from '@/src/types';
import { isWeightItem, toStrictDecimal3 } from '@/src/lib/currencyUtils';

const STORAGE_KEY = 'shomedesk_pack_configs_v1';

// In-memory cache for ultra-fast synchronous lookup during high-speed barcode scanning
const memoryCache: Map<string, ProductPackConfig> = new Map();

function cleanKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\/\s.#$[\]]/g, '_');
}

function getCacheKeys(businessId: string, item: {
  productId?: string;
  productCode?: string;
  barcode?: string;
  name?: string;
}): string[] {
  const bId = businessId || 'default';
  const keys: string[] = [];

  if (item.barcode && item.barcode.trim()) {
    keys.push(`${bId}_bc_${cleanKey(item.barcode)}`);
    // Also store normalized digits only if numeric
    const digits = item.barcode.replace(/\D/g, '');
    if (digits && digits !== item.barcode) {
      keys.push(`${bId}_bc_${digits}`);
    }
  }

  if (item.productId && item.productId.trim()) {
    keys.push(`${bId}_pid_${cleanKey(item.productId)}`);
  }

  if (item.productCode && item.productCode.trim()) {
    keys.push(`${bId}_code_${cleanKey(item.productCode)}`);
  }

  if (item.name && item.name.trim()) {
    keys.push(`${bId}_name_${cleanKey(item.name)}`);
  }

  return keys;
}

// Read localStorage cache
function loadLocalStore(): Record<string, ProductPackConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Save to localStorage cache
function saveLocalStore(store: Record<string, ProductPackConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('Failed to write to localStorage for pack configs:', err);
  }
}

/**
 * Retrieve saved pack configuration for a product.
 * Returns instantly from memory or localStorage.
 */
export function getProductPackConfig(
  businessId: string,
  item: {
    productId?: string;
    productCode?: string;
    barcode?: string;
    name?: string;
  }
): ProductPackConfig | null {
  const keys = getCacheKeys(businessId, item);

  // 1. Check in-memory map
  for (const k of keys) {
    if (memoryCache.has(k)) {
      return memoryCache.get(k)!;
    }
  }

  // 2. Check localStorage
  const localStore = loadLocalStore();
  for (const k of keys) {
    if (localStore[k]) {
      const config = localStore[k];
      memoryCache.set(k, config);
      return config;
    }
  }

  return null;
}

/**
 * Persist pack configuration for a product.
 * Updates in-memory cache, localStorage, and Firestore.
 */
export async function saveProductPackConfig(
  businessId: string,
  item: {
    productId?: string;
    productCode?: string;
    barcode?: string;
    name: string;
    piecesPerPack?: number;
    orderMode?: 'pcs' | 'pack';
    packPrice?: number;
    unitPrice?: number;
  }
): Promise<void> {
  if (!item.name && !item.barcode && !item.productId) return;

  const piecesPerPack = Number(item.piecesPerPack) || 24;
  const orderMode = item.orderMode || 'pack';
  const packPrice = Number(item.packPrice) || 0;
  const unitPrice = Number(item.unitPrice) || (piecesPerPack > 0 && packPrice > 0 ? packPrice / piecesPerPack : 0);

  const config: ProductPackConfig = {
    businessId: businessId || 'default',
    productId: item.productId || '',
    productCode: item.productCode || '',
    barcode: item.barcode || '',
    productName: (item.name || '').trim(),
    piecesPerPack,
    orderMode,
    packPrice,
    unitPrice,
    updatedAt: new Date().toISOString(),
  };

  const keys = getCacheKeys(businessId, item);

  // 1. Update in-memory cache
  for (const k of keys) {
    memoryCache.set(k, config);
  }

  // 2. Update localStorage
  const localStore = loadLocalStore();
  for (const k of keys) {
    localStore[k] = config;
  }
  saveLocalStore(localStore);

  // 3. Persist to Firestore asynchronously (fire & forget to avoid blocking UI)
  try {
    const primaryKey = item.barcode
      ? `bc_${cleanKey(item.barcode)}`
      : item.productId
      ? `pid_${cleanKey(item.productId)}`
      : `name_${cleanKey(item.name)}`;

    const docId = `pk_${businessId || 'default'}_${primaryKey}`;
    const docRef = doc(db, 'productPackConfigs', docId);

    setDoc(
      docRef,
      {
        ...config,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => {
      console.warn('Async firestore save for pack config warning:', err);
    });
  } catch (err) {
    console.warn('Error saving pack config to Firestore:', err);
  }
}

/**
 * Preload all pack configs for a business into memory for lightning-fast scanning
 */
export async function preloadBusinessPackConfigs(businessId: string): Promise<void> {
  if (!businessId) return;
  try {
    const q = query(
      collection(db, 'productPackConfigs'),
      where('businessId', '==', businessId)
    );
    const snap = await getDocs(q);
    const localStore = loadLocalStore();

    snap.docs.forEach((d) => {
      const data = d.data() as ProductPackConfig;
      const keys = getCacheKeys(businessId, {
        productId: data.productId,
        productCode: data.productCode,
        barcode: data.barcode,
        name: data.productName,
      });

      for (const k of keys) {
        memoryCache.set(k, data);
        localStore[k] = data;
      }
    });

    saveLocalStore(localStore);
  } catch (err) {
    console.warn('Could not preload pack configs from Firestore:', err);
  }
}

/**
 * Creates a brand new PurchaseOrderItem from a selected/scanned product.
 * - Defaults orderMode: 'pack' immediately (as user requested).
 * - Loads remembered piecesPerPack if previously set!
 * - Weight items (kg) default to orderMode: 'pcs', unit: 'kg'.
 */
export function buildItemFromProduct(
  product: SalesPlayProduct,
  businessId: string,
  preferredUnitCost?: number
): PurchaseOrderItem {
  const isWeight = Boolean(
    product.is_weight_item ||
    product.measurement?.toLowerCase() === 'kg' ||
    isWeightItem(product.product_name)
  );

  const unitCost = Number(
    preferredUnitCost !== undefined && preferredUnitCost !== null
      ? preferredUnitCost
      : (product.last_purchase_cost ?? product.cost ?? 0)
  );

  const salesPrice = Number(product.price || 0);

  // For weight items: sold/purchased by weight in kg
  if (isWeight) {
    const defaultQty = 1.000;
    return {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      productId: product.id,
      productCode: product.product_code,
      name: product.product_name,
      barcode: product.barcode || product.product_code || '',
      category: product.category || 'General',
      unit: 'kg',
      orderMode: 'pcs',
      quantity: defaultQty,
      unitPrice: unitCost,
      salesPrice,
      totalPrice: toStrictDecimal3(defaultQty * unitCost),
      currentStock: Number(product.in_stock || 0),
      measurement: 'kg',
    };
  }

  // Non-weight items: default to Pack (as requested by user)
  const savedConfig = getProductPackConfig(businessId, {
    productId: product.id,
    productCode: product.product_code,
    barcode: product.barcode,
    name: product.product_name,
  });

  const orderMode = savedConfig?.orderMode || 'pack';
  // Use saved piecesPerPack if set; otherwise default to 24
  const piecesPerPack = savedConfig?.piecesPerPack && savedConfig.piecesPerPack > 0
    ? savedConfig.piecesPerPack
    : 24;

  let packPrice = 0;
  if (savedConfig?.packPrice && savedConfig.packPrice > 0) {
    packPrice = savedConfig.packPrice;
  } else {
    packPrice = toStrictDecimal3(unitCost * piecesPerPack);
  }

  const effectiveUnitCost = piecesPerPack > 0 && packPrice > 0
    ? Math.round((packPrice / piecesPerPack) * 10000) / 10000
    : unitCost;

  if (orderMode === 'pack') {
    const packCount = 1;
    const totalQty = Math.round(packCount * piecesPerPack * 1000) / 1000;
    const totalPrice = toStrictDecimal3(packCount * packPrice);

    return {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      productId: product.id,
      productCode: product.product_code,
      name: product.product_name,
      barcode: product.barcode || product.product_code || '',
      category: product.category || 'General',
      unit: 'pack',
      orderMode: 'pack',
      packCount,
      piecesPerPack,
      packPrice,
      quantity: totalQty, // Base quantity in pieces for SalesPlay stock sync
      unitPrice: effectiveUnitCost,
      salesPrice,
      totalPrice,
      currentStock: Number(product.in_stock || 0),
      measurement: product.measurement || 'pcs',
    };
  }

  // Fallback if saved config was explicitly set to 'pcs'
  const qty = 1;
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    productId: product.id,
    productCode: product.product_code,
    name: product.product_name,
    barcode: product.barcode || product.product_code || '',
    category: product.category || 'General',
    unit: 'pcs',
    orderMode: 'pcs',
    quantity: qty,
    unitPrice: unitCost,
    salesPrice,
    totalPrice: toStrictDecimal3(qty * unitCost),
    currentStock: Number(product.in_stock || 0),
    measurement: product.measurement || 'pcs',
  };
}

/**
 * Creates a custom blank item with a scanned barcode
 */
export function buildCustomItemWithBarcode(
  barcode: string,
  businessId: string
): PurchaseOrderItem {
  const savedConfig = getProductPackConfig(businessId, { barcode });
  const piecesPerPack = savedConfig?.piecesPerPack && savedConfig.piecesPerPack > 0
    ? savedConfig.piecesPerPack
    : 24;

  const packCount = 1;
  const packPrice = savedConfig?.packPrice || 0;
  const unitPrice = piecesPerPack > 0 && packPrice > 0
    ? Math.round((packPrice / piecesPerPack) * 10000) / 10000
    : 0;

  return {
    id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: '',
    barcode,
    category: 'General',
    unit: 'pack',
    orderMode: 'pack',
    packCount,
    piecesPerPack,
    packPrice,
    quantity: packCount * piecesPerPack,
    unitPrice,
    totalPrice: toStrictDecimal3(packCount * packPrice),
  };
}
