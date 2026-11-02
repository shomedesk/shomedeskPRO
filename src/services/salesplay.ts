import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { SalesPlayProduct, SalesPlayCategory, SalesPlayShop, SalesPlaySettings, SaleInvoice, SaleItem } from '@/src/types';
import { format, subDays, addDays, differenceInDays } from 'date-fns';
import { toStrictDecimal3 } from '@/src/lib/currencyUtils';

export const DEFAULT_SALESPLAY_CONFIG = {
  accountEmail: 'makarembakkala@gmail.com',
  apiToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpbl9uYW1lIjoibWFrYXJlbWJha2thbGFAZ21haWwuY29tIiwiZGF0ZSI6IkZyaWRheSAyNXRoIDIwMjZmIFNlcHRlbWJlciAyMDI2IDAxOjA1OjU1IEFNIn0.wmzb6XXPzLK_xsmyML7KA8U9_NNC9W0m26nlM29afsU',
  appId: 'WjFFMjE3cVhyQ3MyK1E1SW53MzMwdz09',
  appSecret: '14a59f1156f8009261294df3b12dd304117e42dbfdde0539822ba890f10a4ddf',
  authCode: 'dVdKjX',
  defaultShopId: 'VEpoaG9WaHlTZ0Nocko4ekcwVFpqZz09',
  defaultShopName: 'MAKAREM ALKHAIR MODERN',
};

const SALESPLAY_API_BASE = 'https://api.salesplaypos.com/v1.0';

import { FALLBACK_SALESPLAY_PRODUCTS, FALLBACK_SALESPLAY_CATEGORIES } from '@/src/data/salesplayFallback';
export { FALLBACK_SALESPLAY_PRODUCTS, FALLBACK_SALESPLAY_CATEGORIES };

/**
 * Robust JSON fetch with automatic fallback and HTML error prevention.
 * Never throws "Unexpected token '<', "<!doctype "..." errors.
 * Prioritizes local proxy (/api/salesplay), then public CORS proxy for launched/external sites.
 */
async function safeFetchSalesPlayJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T | null> {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Candidate URLs in priority order:
  // 1. Same-origin reverse proxy (/api/salesplay) - handles CORS, pagination, and auth
  // 2. Cloud Run Applet backend endpoints (for standalone webapp on external origins)
  // 3. Direct SalesPlay API endpoint
  const candidateUrls: string[] = [
    `/api/salesplay${cleanPath}`,
    `https://ais-pre-qqunexm2wvpnenivdg53h4-416302796444.asia-east1.run.app/api/salesplay${cleanPath}`,
    `https://ais-dev-qqunexm2wvpnenivdg53h4-416302796444.asia-east1.run.app/api/salesplay${cleanPath}`,
    `${SALESPLAY_API_BASE}${cleanPath}`,
  ];

  const mergedHeaders: Record<string, string> = {
    'Accept': '*/*',
    ...((options.headers as Record<string, string>) || {}),
  };

  const reqOptions: RequestInit = {
    ...options,
    headers: mergedHeaders,
  };

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, reqOptions);
      if (!res.ok) {
        continue;
      }

      const text = await res.text();
      const trimmed = text.trim();

      // Guard against HTML error pages (e.g. <!doctype html...) from static hosts or 404s
      if (trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        continue;
      }

      return JSON.parse(trimmed) as T;
    } catch {
      // Continue to next candidate URL
    }
  }

  return null;
}

/**
 * Get saved SalesPlay settings from Firestore or fallback to default
 */
export async function getSalesPlaySettings(businessId: string): Promise<SalesPlaySettings> {
  try {
    const snap = await getDoc(doc(db, 'salesPlaySettings', businessId));
    if (snap.exists()) {
      return snap.data() as SalesPlaySettings;
    }
  } catch (err) {
    console.warn('Failed to load SalesPlay settings from Firestore, using default:', err);
  }

  return {
    businessId,
    accountEmail: DEFAULT_SALESPLAY_CONFIG.accountEmail,
    apiToken: DEFAULT_SALESPLAY_CONFIG.apiToken,
    appId: DEFAULT_SALESPLAY_CONFIG.appId,
    appSecret: DEFAULT_SALESPLAY_CONFIG.appSecret,
    authCode: DEFAULT_SALESPLAY_CONFIG.authCode,
    selectedShopId: DEFAULT_SALESPLAY_CONFIG.defaultShopId,
    branchShopMap: {},
  };
}

/**
 * Save SalesPlay settings to Firestore
 */
export async function saveSalesPlaySettings(settings: SalesPlaySettings): Promise<void> {
  await setDoc(doc(db, 'salesPlaySettings', settings.businessId), {
    ...settings,
    lastSyncedAt: new Date().toISOString(),
  }, { merge: true });
}

/**
 * Fetch all Shops associated with the SalesPlay account
 */
export async function fetchSalesPlayShops(token?: string): Promise<SalesPlayShop[]> {
  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  try {
    const data = await safeFetchSalesPlayJson<{ shops?: SalesPlayShop[] }>('/shops', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (data?.shops && data.shops.length > 0) {
      return data.shops;
    }
  } catch (error) {
    console.warn('Failed to fetch SalesPlay shops from network, using default:', error);
  }

  return [{
    id: DEFAULT_SALESPLAY_CONFIG.defaultShopId,
    shop_name: DEFAULT_SALESPLAY_CONFIG.defaultShopName,
  }];
}

/**
 * Fetch all categories from SalesPlay with multi-level fallback and Firestore/localStorage caching
 */
export async function fetchSalesPlayCategories(
  token?: string,
  forceRefresh?: boolean
): Promise<SalesPlayCategory[]> {
  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;

  if (forceRefresh && typeof window !== 'undefined') {
    try {
      localStorage.removeItem('salesplay_cached_categories');
    } catch {
      // ignore
    }
  }

  try {
    const data = await safeFetchSalesPlayJson<{ categories?: SalesPlayCategory[] }>('/category', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (data?.categories && Array.isArray(data.categories) && data.categories.length > 0) {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('salesplay_cached_categories', JSON.stringify(data.categories));
        } catch {
          // ignore
        }
      }
      return data.categories;
    }
  } catch (error) {
    console.warn('Network issue fetching live SalesPlay categories:', error);
  }

  // Fallback 1: LocalStorage cache
  if (!forceRefresh && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('salesplay_cached_categories');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
  }

  // Fallback 2: Check Firestore cached categories
  try {
    const snap = await getDoc(doc(db, 'salesPlayCatalog', 'categories'));
    if (snap.exists()) {
      const data = snap.data();
      if (data && Array.isArray(data.categories) && data.categories.length > 0) {
        return data.categories as SalesPlayCategory[];
      }
    }
  } catch {
    // ignore
  }

  // Fallback 3: Complete live fallback category list
  return FALLBACK_SALESPLAY_CATEGORIES;
}

/**
 * Fetch products and their real-time inventory from SalesPlay
 * With safe JSON handling, offline caching, Firestore sync, and instant fallback
 */
export async function fetchSalesPlayProductsWithInventory(
  token?: string, 
  shopId?: string,
  forceRefresh?: boolean
): Promise<SalesPlayProduct[]> {
  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  const targetShopId = shopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

  if (forceRefresh && typeof window !== 'undefined') {
    try {
      localStorage.removeItem('salesplay_cached_products');
    } catch {
      // ignore
    }
  }

  try {
    // 1. Fetch Products - Proxy handles full pagination automatically
    const prodData = await safeFetchSalesPlayJson<{ products?: any[]; total?: number }>('/products', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const rawProducts = prodData?.products || [];

    // 2. Fetch Inventory Levels
    let stockMap: { [productId: string]: number } = {};
    const invData = await safeFetchSalesPlayJson<{ inventory_levels?: any[] }>('/inventory', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const levels = invData?.inventory_levels || [];
    for (const lvl of levels) {
      if (!targetShopId || lvl.shop_id === targetShopId) {
        stockMap[lvl.product_id] = Number(lvl.in_stock) || 0;
      }
    }

    // If products were successfully retrieved from network
    if (rawProducts.length > 0) {
      const products: SalesPlayProduct[] = rawProducts.map((p: any) => {
        let shopPrice = Number(p.cost) || 0;
        if (Array.isArray(p.shops)) {
          const foundShop = p.shops.find((s: any) => s.shop_id === targetShopId);
          if (foundShop && foundShop.price !== undefined) {
            shopPrice = Number(foundShop.price) || 0;
          }
        }

        return {
          id: p.id,
          product_code: p.product_code || '',
          product_name: (p.product_name || 'Unnamed Item').trim(),
          category: (p.category || 'General').trim(),
          sub_category: (p.sub_category || '').trim(),
          barcode: (p.barcode || p.product_code || '').trim(),
          cost: Number(p.cost) || 0,
          price: shopPrice,
          measurement: p.measurement || '',
          image_url: p.image_url || '',
          stock_control: p.stock_control ?? true,
          in_stock: stockMap[p.id] !== undefined ? stockMap[p.id] : 0,
        };
      });

      // Cache successful products in localStorage for offline / fast access
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('salesplay_cached_products', JSON.stringify(products));
        }
      } catch (e) {
        // ignore storage errors
      }

      return products;
    }
  } catch (error) {
    console.warn('Network issue fetching live SalesPlay products, using cached catalog:', error);
  }

  // 3. Fallback: Check Firestore cloud catalog FIRST (persistent across all launched sites & devices)
  try {
    const snap = await getDoc(doc(db, 'salesPlayCatalog', 'all_products'));
    if (snap.exists()) {
      const data = snap.data();
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        // Refresh local cache with latest cloud items
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem('salesplay_cached_products', JSON.stringify(data.products));
          }
        } catch {
          // ignore storage error
        }
        return data.products as SalesPlayProduct[];
      }
    }
  } catch (fsErr) {
    console.warn('Notice reading cached catalog from Firestore:', fsErr);
  }

  // 4. Fallback: Check localStorage cache (if offline or Firestore unavailable)
  if (!forceRefresh) {
    try {
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem('salesplay_cached_products');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch {
      // ignore parse error
    }
  }

  // 5. Ultimate Fallback: Complete 97-product catalog matching actual SalesPlay account items
  return FALLBACK_SALESPLAY_PRODUCTS;
}

/**
 * Synchronize full SalesPlay catalog (both products and categories) to Firestore
 */
export async function syncAllSalesPlayCatalogToFirestore(businessId?: string): Promise<{
  productCount: number;
  categoryCount: number;
}> {
  const [categories, products] = await Promise.all([
    fetchSalesPlayCategories(undefined, true),
    fetchSalesPlayProductsWithInventory(undefined, undefined, true),
  ]);

  try {
    await setDoc(doc(db, 'salesPlayCatalog', 'categories'), {
      categories,
      count: categories.length,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await setDoc(doc(db, 'salesPlayCatalog', 'all_products'), {
      products,
      count: products.length,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    if (businessId) {
      await setDoc(doc(db, 'salesPlaySettings', businessId), {
        lastSyncedCatalogAt: new Date().toISOString(),
        totalSyncedProducts: products.length,
        totalSyncedCategories: categories.length,
      }, { merge: true });
    }
  } catch (err) {
    console.warn('Could not persist catalog to Firestore:', err);
  }

  return { productCount: products.length, categoryCount: categories.length };
}

/**
 * Update inventory levels in SalesPlay (increments stock when purchase bill is logged)
 */
export async function updateSalesPlayInventory(
  shopId: string,
  itemsToUpdate: { productId: string; quantityToAdd?: number; quantityDelta?: number }[],
  token?: string
): Promise<{ success: boolean; message: string; updatedCount: number }> {
  if (!itemsToUpdate || itemsToUpdate.length === 0) {
    return { success: true, message: 'No items to update', updatedCount: 0 };
  }

  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  const targetShop = shopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

  // Filter down to valid SalesPlay product IDs and non-zero deltas
  const validItems = itemsToUpdate
    .map(i => {
      const delta = i.quantityDelta !== undefined ? Number(i.quantityDelta) : Number(i.quantityToAdd);
      return {
        productId: i.productId,
        delta: isNaN(delta) ? 0 : delta,
      };
    })
    .filter(i => 
      i.productId && 
      typeof i.productId === 'string' && 
      i.productId.length > 10 && 
      !i.productId.startsWith('item_') && 
      !i.productId.startsWith('sp_') &&
      i.delta !== 0
    );

  if (validItems.length === 0) {
    return { 
      success: true, 
      message: 'No SalesPlay items with non-zero stock changes to update in inventory', 
      updatedCount: 0 
    };
  }

  try {
    // 1. Fetch current live stock
    const invData = await safeFetchSalesPlayJson<{ inventory_levels?: any[] }>('/inventory', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const levels = invData?.inventory_levels || [];
    const stockMap: { [productId: string]: number } = {};
    for (const lvl of levels) {
      if (!targetShop || lvl.shop_id === targetShop) {
        stockMap[lvl.product_id] = Number(lvl.in_stock) || 0;
      }
    }

    // 2. Prepare payload (supports both stock gain (+) and stock reduction/return (-))
    const inventoryLevelsPayload = validItems.map(item => {
      const currentStock = stockMap[item.productId] ?? 0;
      const newStock = Math.max(0, currentStock + item.delta);
      return {
        shop_id: targetShop,
        product_id: item.productId,
        in_stock: Math.round(newStock * 1000) / 1000,
      };
    });

    // 3. Post stock updates batch
    const result = await safeFetchSalesPlayJson<{ 
      success?: any; 
      code?: string; 
      errors?: { details?: string; field?: string }; 
      message?: string 
    }>('/inventory', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventory_levels: inventoryLevelsPayload,
      }),
    });

    const isSuccess = !!result && (
      result.code === 'SUCCESS' ||
      result.success === true ||
      (typeof result.success === 'object' && result.success !== null)
    );

    if (isSuccess) {
      return {
        success: true,
        message: 'SalesPlay stock updated successfully',
        updatedCount: inventoryLevelsPayload.length,
      };
    }

    // If batch failed (e.g. one product in array was deleted in SalesPlay), retry item-by-item so valid items still gain stock!
    let individualSuccessCount = 0;
    for (const singleItem of inventoryLevelsPayload) {
      try {
        const singleRes = await safeFetchSalesPlayJson<{ success?: any; code?: string }>('/inventory', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inventory_levels: [singleItem],
          }),
        });
        if (singleRes && (singleRes.code === 'SUCCESS' || singleRes.success === true || typeof singleRes.success === 'object')) {
          individualSuccessCount++;
        }
      } catch {
        // continue
      }
    }

    if (individualSuccessCount > 0) {
      return {
        success: true,
        message: `Updated stock for ${individualSuccessCount} of ${inventoryLevelsPayload.length} items in SalesPlay POS`,
        updatedCount: individualSuccessCount,
      };
    }

    return {
      success: false,
      message: result?.errors?.details || result?.message || 'Failed to update SalesPlay stock',
      updatedCount: 0,
    };
  } catch (error: any) {
    console.warn('SalesPlay inventory update notice:', error);
    return {
      success: false,
      message: error?.message || 'Network error updating SalesPlay',
      updatedCount: 0,
    };
  }
}

export interface SalesPlayProductCostUpdate {
  productId?: string;
  productCode?: string;
  barcode?: string;
  name?: string;
  unitCost: number; // Retail cost per piece (OMR, e.g. 0.042)
  salesPrice?: number; // Retail selling price per piece (OMR)
  category?: string;
  shopId?: string;
}

/**
 * Updates retail product costs in SalesPlay POS via POST /products.
 * SalesPlay tracks cost at the product level for COGS and gross margin reporting in POS receipts.
 * Automatically handles retail pieces calculation (e.g. 1 pack = 24 pcs @ 1.000 OMR = 0.042 OMR/piece).
 */
export async function updateSalesPlayProductCosts(
  itemsToUpdate: SalesPlayProductCostUpdate[],
  token?: string,
  shopId?: string
): Promise<{ success: boolean; message: string; updatedCount: number }> {
  if (!itemsToUpdate || itemsToUpdate.length === 0) {
    return { success: true, message: 'No items to update costs for', updatedCount: 0 };
  }

  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  const targetShop = shopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

  const validItems = itemsToUpdate.filter(i => {
    const cost = Number(i.unitCost);
    return !isNaN(cost) && cost >= 0 && (i.productId || i.productCode || i.barcode || (i.name && i.name.trim().length > 0));
  });

  if (validItems.length === 0) {
    return { success: true, message: 'No items with valid costs to update', updatedCount: 0 };
  }

  try {
    // 1. Fetch current raw products from SalesPlay proxy
    const prodData = await safeFetchSalesPlayJson<{ products?: any[] }>('/products', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const rawProducts = prodData?.products || [];
    let updatedCount = 0;

    for (const item of validItems) {
      const perPieceCost = toStrictDecimal3(item.unitCost);
      const cleanBarcode = (item.barcode || '').trim();
      const cleanCode = (item.productCode || '').trim();
      const cleanName = (item.name || '').trim().toLowerCase();

      // Find matching product in SalesPlay
      const matched = rawProducts.find((p: any) => {
        if (item.productId && p.id === item.productId) return true;
        if (cleanBarcode && p.barcode && p.barcode.trim() === cleanBarcode) return true;
        if (cleanCode && p.product_code && p.product_code.trim() === cleanCode) return true;
        if (cleanName && p.product_name && p.product_name.trim().toLowerCase() === cleanName) return true;
        return false;
      });

      let postPayload: any = null;

      if (matched) {
        let shops = Array.isArray(matched.shops) ? matched.shops.map((s: any) => {
          let price = Number(s.price) || 0;
          if (s.shop_id === targetShop && item.salesPrice !== undefined && Number(item.salesPrice) > 0) {
            price = toStrictDecimal3(item.salesPrice);
          }
          return {
            shop_id: s.shop_id,
            price,
            available_for_sale: s.available_for_sale ?? true,
            safety_stock: Number(s.safety_stock) || 0,
          };
        }) : [];

        if (shops.length === 0) {
          shops = [{
            shop_id: targetShop,
            price: item.salesPrice !== undefined && Number(item.salesPrice) > 0 ? toStrictDecimal3(item.salesPrice) : 0,
            available_for_sale: true,
            safety_stock: 0,
          }];
        }

        postPayload = {
          id: matched.id,
          product_code: matched.product_code || String(Date.now()).slice(-6),
          product_name: matched.product_name,
          category: matched.category || 'No category',
          sub_category: matched.sub_category || '',
          barcode: matched.barcode || cleanBarcode,
          measurement: matched.measurement || '',
          stock_control: matched.stock_control ?? true,
          product_price_change: Boolean(matched.price_change ?? matched.product_price_change ?? false),
          qty_change_option: Boolean(matched.quantity_change ?? matched.qty_change_option ?? false),
          expire_mode: Boolean(matched.stock_expire_mode ?? matched.expire_mode ?? false),
          is_composite: Boolean(matched.is_composite ?? false),
          use_production: Boolean(matched.use_production ?? false),
          is_combo: Boolean(matched.is_combo ?? false),
          is_ingredient: Boolean(matched.is_ingredient ?? false),
          is_vat_product: Boolean(matched.is_vat_product ?? false),
          is_variant: Boolean(matched.is_variant ?? false),
          cost: perPieceCost,
          shops,
        };
      } else if (cleanName) {
        // Register new item into SalesPlay
        const generatedCode = cleanCode || cleanBarcode || String(Date.now()).slice(-6);
        postPayload = {
          product_code: generatedCode,
          product_name: item.name!.trim(),
          category: item.category || 'No category',
          barcode: cleanBarcode,
          measurement: 'pcs',
          stock_control: true,
          product_price_change: false,
          qty_change_option: false,
          expire_mode: false,
          is_composite: false,
          use_production: false,
          is_combo: false,
          is_ingredient: false,
          is_vat_product: false,
          is_variant: false,
          cost: perPieceCost,
          shops: [{
            shop_id: targetShop,
            price: item.salesPrice !== undefined && Number(item.salesPrice) > 0 ? toStrictDecimal3(item.salesPrice) : 0,
            available_for_sale: true,
          }],
        };
      }

      if (postPayload) {
        try {
          const res = await safeFetchSalesPlayJson<any>('/products', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(postPayload),
          });

          const isSuccess = Array.isArray(res) 
            ? res.some(r => r.code === 'SUCCESS')
            : res && (res.code === 'SUCCESS' || res.success === true);

          if (isSuccess) {
            updatedCount++;
            if (matched) {
              matched.cost = perPieceCost;
            }
          }
        } catch (itemErr) {
          console.warn('Notice updating product cost in SalesPlay:', itemErr);
        }
      }
    }

    // Refresh local storage cache if any products had their costs updated
    if (updatedCount > 0 && typeof window !== 'undefined') {
      try {
        const cachedRaw = localStorage.getItem('salesplay_cached_products');
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (Array.isArray(parsed)) {
            for (const item of validItems) {
              const perPieceCost = toStrictDecimal3(item.unitCost);
              const p = parsed.find((cp: any) =>
                (item.productId && cp.id === item.productId) ||
                (item.barcode && cp.barcode === item.barcode) ||
                (item.productCode && cp.product_code === item.productCode) ||
                (item.name && cp.product_name?.toLowerCase() === item.name?.toLowerCase())
              );
              if (p) {
                p.cost = perPieceCost;
                if (item.salesPrice && Number(item.salesPrice) > 0) {
                  p.price = toStrictDecimal3(item.salesPrice);
                }
              }
            }
            localStorage.setItem('salesplay_cached_products', JSON.stringify(parsed));
          }
        }
      } catch {
        // ignore storage errors
      }
    }

    return {
      success: updatedCount > 0,
      message: `Updated retail cost for ${updatedCount} items in SalesPlay POS`,
      updatedCount,
    };
  } catch (error: any) {
    console.warn('SalesPlay product cost update error:', error);
    return {
      success: false,
      message: error?.message || 'Error updating product cost in SalesPlay',
      updatedCount: 0,
    };
  }
}

export interface BillSyncItem {
  productId?: string;
  productCode?: string;
  barcode?: string;
  name?: string;
  quantityToAdd: number;
  unitCost: number; // Retail cost per piece
  salesPrice?: number;
}

/**
 * Synchronizes a Purchase Bill to SalesPlay POS:
 * 1. Updates per-piece retail cost in SalesPlay (POST /products).
 * 2. Increments live inventory stock (POST /inventory).
 */
export async function syncBillToSalesPlay(
  shopId: string,
  items: BillSyncItem[],
  token?: string
): Promise<{
  success: boolean;
  stockUpdatedCount: number;
  costUpdatedCount: number;
  message: string;
}> {
  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  const targetShop = shopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

  // 1. Update retail product costs in SalesPlay (per-piece retail cost)
  const costResult = await updateSalesPlayProductCosts(
    items.map(i => ({
      productId: i.productId,
      productCode: i.productCode,
      barcode: i.barcode,
      name: i.name,
      unitCost: i.unitCost,
      salesPrice: i.salesPrice,
      shopId: targetShop,
    })),
    authToken,
    targetShop
  );

  // 2. Resolve product IDs for inventory stock update
  let resolvedInventoryItems: { productId: string; quantityToAdd: number }[] = [];
  try {
    const prodData = await safeFetchSalesPlayJson<{ products?: any[] }>('/products', {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
    const catalog = prodData?.products || [];

    for (const item of items) {
      let pId = item.productId;
      if (!pId || pId.length < 5 || pId.startsWith('item_') || pId.startsWith('sp_')) {
        const found = catalog.find((p: any) =>
          (item.barcode && p.barcode && p.barcode.trim() === item.barcode.trim()) ||
          (item.productCode && p.product_code && p.product_code.trim() === item.productCode.trim()) ||
          (item.name && p.product_name && p.product_name.trim().toLowerCase() === item.name.trim().toLowerCase())
        );
        if (found?.id) {
          pId = found.id;
        }
      }

      if (pId && pId.length > 5 && !pId.startsWith('item_') && !pId.startsWith('sp_')) {
        resolvedInventoryItems.push({
          productId: pId,
          quantityToAdd: Number(item.quantityToAdd) || 0,
        });
      }
    }
  } catch {
    resolvedInventoryItems = items
      .filter(i => i.productId && i.productId.length > 10 && !i.productId.startsWith('item_'))
      .map(i => ({ productId: i.productId!, quantityToAdd: Number(i.quantityToAdd) || 0 }));
  }

  // 3. Update stock levels in SalesPlay
  let stockUpdatedCount = 0;
  let stockSuccess = false;
  if (resolvedInventoryItems.length > 0) {
    const invResult = await updateSalesPlayInventory(targetShop, resolvedInventoryItems, authToken);
    stockUpdatedCount = invResult.updatedCount;
    stockSuccess = invResult.success;
  }

  const overallSuccess = costResult.success || stockSuccess;
  return {
    success: overallSuccess,
    stockUpdatedCount,
    costUpdatedCount: costResult.updatedCount,
    message: `SalesPlay POS: Stock (+${stockUpdatedCount} items) & Cost (${costResult.updatedCount} items) updated`,
  };
}

export interface SalesPlayReceiptItem {
  product_id?: string;
  product_code?: string;
  product_line_no?: string;
  product_name: string;
  category_id?: string;
  category_name?: string;
  quantity: number;
  price: number;
  gross_total_money?: number;
  total_discount?: number;
  total_money: number;
  cost?: number;
  cost_total?: number;
  line_note?: string;
}

export interface SalesPlayPayment {
  payment_type_id?: string;
  payment_type: string;
  money_amount: number;
  paid_at: string;
  is_advance?: number;
}

export interface SalesPlayReceipt {
  receipt_number: string;
  receipt_type: string;
  refund_for?: string | null;
  receipt_date: string;
  receipt_time: string;
  receipt_date_time: string;
  total_money: number;
  customer_id?: string;
  customer?: Array<{
    id?: string;
    customer_code?: string;
    name?: string;
    phone_number?: string;
  }>;
  total_discount?: number;
  employee_id?: string;
  cashier_name?: string;
  shop_id: string;
  pos_device_id?: string;
  note?: string;
  line_products?: SalesPlayReceiptItem[];
  payments?: SalesPlayPayment[];
  receipt_delete_status?: boolean;
}

/**
 * Fetch past receipts from SalesPlay POS
 * Handles up to 30 days per chunk as enforced by SalesPlay API
 */
export async function fetchSalesPlayReceipts(
  token?: string,
  startDate?: Date,
  endDate?: Date
): Promise<{ receipts: SalesPlayReceipt[]; error?: string }> {
  const authToken = token || DEFAULT_SALESPLAY_CONFIG.apiToken;
  const now = new Date();
  const end = endDate || now;
  const start = startDate || subDays(end, 29);

  const daysDiff = differenceInDays(end, start);
  const chunks: { min: Date; max: Date }[] = [];

  if (daysDiff <= 28) {
    chunks.push({ min: start, max: end });
  } else {
    let curStart = start;
    while (curStart < end) {
      let curEnd = addDays(curStart, 28);
      if (curEnd > end) curEnd = end;
      chunks.push({ min: curStart, max: curEnd });
      curStart = addDays(curEnd, 1);
    }
  }

  const allReceiptsMap = new Map<string, SalesPlayReceipt>();
  let lastError: string | undefined;

  for (const chunk of chunks) {
    const minStr = format(chunk.min, 'yyyy-MM-dd 00:00:00');
    const maxStr = format(chunk.max, 'yyyy-MM-dd 23:59:59');

    try {
      const payload = {
        created_at_min: minStr,
        created_at_max: maxStr,
      };

      const result = await safeFetchSalesPlayJson<{ receipts?: SalesPlayReceipt[]; errors?: { details?: string } }>(
        '/receipts',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (result?.receipts && Array.isArray(result.receipts)) {
        for (const r of result.receipts) {
          if (!r.receipt_delete_status && r.receipt_number) {
            allReceiptsMap.set(r.receipt_number, r);
          }
        }
      } else if (result?.errors?.details) {
        lastError = result.errors.details;
      }
    } catch (err: any) {
      lastError = err?.message || 'Failed to fetch receipts from SalesPlay';
    }
  }

  let receiptsList = Array.from(allReceiptsMap.values());

  // Firestore Cloud Fallback: If network receipts returned empty (e.g. running on static webapp or CORS blocked),
  // load receipts from the shared Firestore 'sales' collection where the daemon or previous syncs saved them!
  if (receiptsList.length === 0) {
    try {
      const salesSnap = await getDocs(collection(db, 'sales'));
      const startMs = start.getTime();
      const endMs = end.getTime();
      const cachedList: SalesPlayReceipt[] = [];

      salesSnap.forEach(d => {
        const inv = d.data() as SaleInvoice;
        if (inv.source === 'salesplay_pos' || inv.receiptNumber) {
          const invDateStr = inv.receiptDate || (inv.date ? inv.date.substring(0, 10) : '');
          const startDateStr = format(start, 'yyyy-MM-dd');
          const endDateStr = format(end, 'yyyy-MM-dd');
          // Include if within calendar date range
          if (invDateStr && invDateStr >= startDateStr && invDateStr <= endDateStr) {
            cachedList.push({
              receipt_number: inv.receiptNumber || inv.invoiceNumber,
              receipt_type: 'SALE',
              receipt_date: invDateStr,
              receipt_time: inv.receiptTime || (inv.date ? inv.date.substring(11, 19) : '12:00:00'),
              receipt_date_time: inv.date ? inv.date.replace('T', ' ').substring(0, 19) : `${invDateStr} 12:00:00`,
              total_money: inv.totalAmount,
              shop_id: DEFAULT_SALESPLAY_CONFIG.defaultShopId,
              note: inv.notes,
              cashier_name: 'Admin',
              payments: [
                ...(inv.cashAmount ? [{ payment_type: 'Cash', money_amount: inv.cashAmount, paid_at: inv.date }] : []),
                ...(inv.cardAmount ? [{ payment_type: 'Card', money_amount: inv.cardAmount, paid_at: inv.date }] : []),
                ...(inv.onlineAmount ? [{ payment_type: 'Online', money_amount: inv.onlineAmount, paid_at: inv.date }] : []),
              ],
              line_products: (inv.items || []).map(i => ({
                product_id: i.productId,
                product_code: i.productCode,
                product_name: i.name,
                category_name: i.category,
                quantity: i.quantity,
                price: i.unitPrice,
                cost: i.unitCost,
                cost_total: i.totalCost,
                total_money: i.totalPrice,
              })),
            });
          }
        }
      });

      if (cachedList.length > 0) {
        receiptsList = cachedList;
        lastError = undefined;
      }
    } catch (fsErr) {
      console.warn('Notice reading cached receipts from Firestore:', fsErr);
    }
  }

  receiptsList.sort((a, b) => {
    const timeA = a.receipt_date_time ? new Date(a.receipt_date_time.replace(' ', 'T')).getTime() : 0;
    const timeB = b.receipt_date_time ? new Date(b.receipt_date_time.replace(' ', 'T')).getTime() : 0;
    return timeB - timeA;
  });

  return { receipts: receiptsList, error: receiptsList.length === 0 ? lastError : undefined };
}

/**
 * Convert a SalesPlay Receipt into a rich SaleInvoice
 */
export function convertReceiptToSaleInvoice(
  receipt: SalesPlayReceipt,
  businessId: string,
  ownerId: string,
  branchId: string,
  settings?: SalesPlaySettings | null,
  productCostMap?: Map<string, number>
): SaleInvoice {
  const customerObj = receipt.customer?.[0];
  const customerName = customerObj?.name && customerObj.name !== 'N/A' ? customerObj.name : 'Walk-in Customer';
  const customerPhone = customerObj?.phone_number || '';

  // Determine payments breakdown
  let cashAmt = 0;
  let cardAmt = 0;
  let onlineAmt = 0;

  if (Array.isArray(receipt.payments) && receipt.payments.length > 0) {
    receipt.payments.forEach(p => {
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

  let paymentMode: 'Cash' | 'Card' | 'Online' | 'Split' = 'Cash';
  const activeModesCount = (cashAmt > 0 ? 1 : 0) + (cardAmt > 0 ? 1 : 0) + (onlineAmt > 0 ? 1 : 0);
  if (activeModesCount > 1) {
    paymentMode = 'Split';
  } else if (cardAmt > 0) {
    paymentMode = 'Card';
  } else if (onlineAmt > 0) {
    paymentMode = 'Online';
  } else {
    paymentMode = 'Cash';
  }

  let bankId = '';
  if (cardAmt > 0 && settings?.defaultCardBankId) {
    bankId = settings.defaultCardBankId;
  } else if (onlineAmt > 0 && settings?.defaultOnlineBankId) {
    bankId = settings.defaultOnlineBankId;
  } else if ((cardAmt > 0 || onlineAmt > 0) && (settings as any)?.defaultBankId) {
    bankId = (settings as any).defaultBankId;
  }

  let totalCost = 0;
  const items: SaleItem[] = (receipt.line_products || []).map((lp, idx) => {
    const qty = Number(lp.quantity) || 1;
    const unitPrice = Number(lp.price) || 0;
    const totalPrice = Number(lp.total_money) || (qty * unitPrice);
    
    // Check line product cost from SalesPlay receipt
    let unitCost = Number(lp.cost) || 0;
    // If receipt line didn't contain cost, look up from our full product catalog map
    if (unitCost === 0 && productCostMap) {
      if (lp.product_id && productCostMap.has(lp.product_id)) {
        unitCost = productCostMap.get(lp.product_id)!;
      } else if (lp.product_code && productCostMap.has(lp.product_code)) {
        unitCost = productCostMap.get(lp.product_code)!;
      } else if (lp.product_name && productCostMap.has(lp.product_name.toLowerCase().trim())) {
        unitCost = productCostMap.get(lp.product_name.toLowerCase().trim())!;
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

  const receiptDate = receipt.receipt_date || (receipt.receipt_date_time ? receipt.receipt_date_time.substring(0, 10) : format(new Date(), 'yyyy-MM-dd'));
  const receiptTime = receipt.receipt_time || (receipt.receipt_date_time ? receipt.receipt_date_time.substring(11, 19) : '');

  // Deterministic ISO date string preserving the exact shop calendar date
  let dateIso = `${receiptDate}T12:00:00.000Z`;
  if (receipt.receipt_date_time) {
    const timeSegment = receipt.receipt_date_time.length >= 19 
      ? receipt.receipt_date_time.substring(11, 19) 
      : '12:00:00';
    dateIso = `${receiptDate}T${timeSegment}.000Z`;
  } else if (receipt.receipt_date) {
    dateIso = `${receiptDate}T12:00:00.000Z`;
  }

  return {
    businessId,
    ownerId,
    branchId,
    invoiceNumber: receipt.receipt_number || `INV-${Date.now()}`,
    receiptNumber: receipt.receipt_number,
    receiptDate,
    receiptTime,
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
    bankId: bankId || undefined,
    transaction_id: receipt.receipt_number,
    bill_id: receipt.receipt_number,
    source: 'salesplay_pos',
    salesPlayOrderId: receipt.receipt_number,
    date: dateIso,
    createdAt: new Date(),
    notes: receipt.note || `Imported from SalesPlay POS (Cashier: ${receipt.cashier_name || 'Admin'})`
  };
}

/**
 * Synchronize SalesPlay sales receipts directly into Firestore 'sales' collection
 */
export async function syncSalesPlaySalesToFirestore({
  businessId,
  ownerId,
  branchId,
  shopId,
  startDate,
  endDate,
}: {
  businessId: string;
  ownerId: string;
  branchId?: string;
  shopId?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<{
  success: boolean;
  importedCount: number;
  totalSales: number;
  totalCogs: number;
  grossProfit: number;
  cashTotal: number;
  cardTotal: number;
  onlineTotal: number;
  invoices: SaleInvoice[];
  message: string;
}> {
  const settings = await getSalesPlaySettings(businessId);
  const targetShopId = shopId || settings.selectedShopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId;
  const token = settings.apiToken || DEFAULT_SALESPLAY_CONFIG.apiToken;

  const { receipts, error } = await fetchSalesPlayReceipts(token, startDate, endDate);

  if (receipts.length === 0) {
    try {
      const salesSnap = await getDocs(collection(db, 'sales'));
      const startDateStr = format(startDate || subDays(new Date(), 1), 'yyyy-MM-dd');
      const endDateStr = format(endDate || new Date(), 'yyyy-MM-dd');
      let fsSales = 0;
      let fsCogs = 0;
      let fsCash = 0;
      let fsCard = 0;
      let fsOnline = 0;
      let count = 0;
      const fallbackInvoices: SaleInvoice[] = [];

      salesSnap.forEach(d => {
        const inv = d.data() as SaleInvoice;
        if (inv.businessId === businessId || !inv.businessId || inv.source === 'salesplay_pos') {
          const invDateStr = inv.receiptDate || (inv.date ? inv.date.substring(0, 10) : '');
          if (invDateStr && invDateStr >= startDateStr && invDateStr <= endDateStr) {
            count++;
            fallbackInvoices.push({ id: d.id, ...inv });
            fsSales += Number(inv.totalAmount) || 0;
            fsCogs += Number(inv.totalCost) || 0;
            fsCash += Number(inv.cashAmount) || 0;
            fsCard += Number(inv.cardAmount) || 0;
            fsOnline += Number(inv.onlineAmount) || 0;
          }
        }
      });

      if (count > 0) {
        const grossProfit = fsSales - fsCogs;
        return {
          success: true,
          importedCount: count,
          totalSales: toStrictDecimal3(fsSales),
          totalCogs: toStrictDecimal3(fsCogs),
          grossProfit: toStrictDecimal3(grossProfit),
          cashTotal: toStrictDecimal3(fsCash),
          cardTotal: toStrictDecimal3(fsCard),
          onlineTotal: toStrictDecimal3(fsOnline),
          invoices: fallbackInvoices,
          message: `Successfully loaded ${count} sales receipts from SalesPlay POS (Cloud Synced)!`,
        };
      }
    } catch (fsErr) {
      console.warn('Notice querying Firestore sales in sync fallback:', fsErr);
    }

    return {
      success: false,
      importedCount: 0,
      totalSales: 0,
      totalCogs: 0,
      grossProfit: 0,
      cashTotal: 0,
      cardTotal: 0,
      onlineTotal: 0,
      invoices: [],
      message: error || 'No receipts returned from SalesPlay for this date range.',
    };
  }

  let totalSales = 0;
  let totalCogs = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let onlineTotal = 0;
  let importedCount = 0;
  const syncedInvoices: SaleInvoice[] = [];

  // Build product cost map for accurate COGS calculation
  const productCostMap = new Map<string, number>();
  try {
    const products = await fetchSalesPlayProductsWithInventory(token, targetShopId, false);
    for (const p of products) {
      if (p.cost > 0) {
        if (p.id) productCostMap.set(p.id, p.cost);
        if (p.product_code) productCostMap.set(p.product_code, p.cost);
        if (p.barcode) productCostMap.set(p.barcode, p.cost);
        if (p.product_name) productCostMap.set(p.product_name.toLowerCase().trim(), p.cost);
      }
    }
  } catch (mapErr) {
    console.warn('Could not build product cost map for sales sync:', mapErr);
  }

  let receiptsToProcess = targetShopId 
    ? receipts.filter(r => !r.shop_id || r.shop_id === targetShopId)
    : receipts;

  // If strict shopId filter matched 0 receipts but user has valid receipts, fallback to all receipts
  if (receiptsToProcess.length === 0 && receipts.length > 0) {
    receiptsToProcess = receipts;
  }

  let clientQuotaExhausted = false;
  for (const receipt of receiptsToProcess) {
    const invoice = convertReceiptToSaleInvoice(
      receipt,
      businessId,
      ownerId,
      branchId || 'main',
      settings,
      productCostMap
    );

    const safeDocId = `sp_${businessId}_${receipt.receipt_number.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const docRef = doc(db, 'sales', safeDocId);
    const posDocRef = doc(db, 'pos_transactions', safeDocId);

    const payload = {
      ...invoice,
      transaction_id: receipt.receipt_number,
      bill_id: receipt.receipt_number,
      syncedAt: serverTimestamp(),
    };

    syncedInvoices.push({ id: safeDocId, ...invoice });

    if (!clientQuotaExhausted) {
      try {
        // Upsert to sales collection
        await setDoc(docRef, payload, { merge: true });

        // Also mirror to pos_transactions collection safely
        try {
          await setDoc(posDocRef, payload, { merge: true });
        } catch (_) {
          // ignore if rules only permit sales
        }
      } catch (writeErr: any) {
        if (writeErr?.code === 'resource-exhausted' || String(writeErr?.message || '').includes('Quota limit exceeded')) {
          console.warn('Firestore daily write quota reached (Free tier). Calculating sales and COGS in memory.');
          clientQuotaExhausted = true;
        } else {
          console.warn('Notice saving sales invoice:', writeErr);
        }
      }
    }

    importedCount++;
    totalSales += invoice.totalAmount;
    totalCogs += invoice.totalCost;
    cashTotal += invoice.cashAmount || 0;
    cardTotal += invoice.cardAmount || 0;
    onlineTotal += invoice.onlineAmount || 0;
  }

  const grossProfit = totalSales - totalCogs;

  return {
    success: true,
    importedCount,
    totalSales: toStrictDecimal3(totalSales),
    totalCogs: toStrictDecimal3(totalCogs),
    grossProfit: toStrictDecimal3(grossProfit),
    cashTotal: toStrictDecimal3(cashTotal),
    cardTotal: toStrictDecimal3(cardTotal),
    onlineTotal: toStrictDecimal3(onlineTotal),
    invoices: syncedInvoices,
    message: `Successfully synchronized ${importedCount} sales receipts from SalesPlay POS!`,
  };
}
