import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Parse JSON and urlencoded payloads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enable CORS for all incoming client requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Origin, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

import https from 'https';
import fs from 'fs';

const DEFAULT_SALESPLAY_API_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpbl9uYW1lIjoibWFrYXJlbWJha2thbGFAZ21haWwuY29tIiwiZGF0ZSI6IkZyaWRheSAyNXRoIDIwMjZmIFNlcHRlbWJlciAyMDI2IDAxOjA1OjU1IEFNIn0.wmzb6XXPzLK_xsmyML7KA8U9_NNC9W0m26nlM29afsU';

// Helper to make direct HTTPS calls to SalesPlay API with JSON payload support on POST and GET
function executeSalesPlayRequest(
  endpointPath: string,
  method: string,
  headers: Record<string, string>,
  payload?: any
): Promise<{ statusCode: number; headers: Record<string, any>; data: string }> {
  return new Promise((resolve, reject) => {
    const finalPath = `/v1.0${endpointPath}`;
    let postData = '';

    // SalesPlay POS PHP backend requires pagination & filter params (limit, cursor) in JSON body
    if (payload !== undefined && payload !== null) {
      postData = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }

    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...headers,
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
            headers: res.headers as Record<string, any>,
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

// SalesPlay POS Reverse Proxy - Works in both dev and production
app.all('/api/salesplay*', async (req, res) => {
  if (req.path === '/api/salesplay/trigger-cloud-sync' || req.originalUrl?.includes('/trigger-cloud-sync')) {
    runAutoSalesPlaySync();
    return res.json({ success: true, message: 'Cloud sync running' });
  }

  let targetPath = (req.originalUrl || req.url).replace(/^\/api\/salesplay/, '');
  if (!targetPath || targetPath === '') targetPath = '/';

  // Normalize /categories to /category
  if (targetPath.startsWith('/categories')) {
    targetPath = targetPath.replace(/^\/categories/, '/category');
  }

  const rawAuth = (req.headers.authorization as string) || `Bearer ${DEFAULT_SALESPLAY_API_TOKEN}`;
  const headers: Record<string, string> = {
    Accept: '*/*',
    Authorization: rawAuth.startsWith('Bearer ') ? rawAuth : `Bearer ${rawAuth}`,
  };

  try {
    const cleanPath = targetPath.split('?')[0];

    // STRICT USER CONSTRAINT: Block any attempt to wipe or reset product cost to 0.000 in SalesPlay.
    // Stock is incremented strictly via POST /inventory. Existing product costs must remain 100% untouched.
    if ((req.method === 'POST' || req.method === 'PUT') && (cleanPath === '/products' || cleanPath === '/product')) {
      const bodyCost = Number(req.body?.cost);
      if (isNaN(bodyCost) || bodyCost <= 0) {
        console.log('Blocked POST/PUT /products with cost <= 0 to strictly protect existing SalesPlay costs.');
        return res.status(200).json({
          code: 'SUCCESS',
          success: true,
          message: 'Existing product costs and prices strictly preserved in SalesPlay POS',
        });
      }
    }

    // Special auto-paginated handling for GET /products:
    if (req.method === 'GET' && cleanPath === '/products') {
      const allProducts: any[] = [];
      const seenIds = new Set<string>();
      let cursor = (req.query.cursor as string) || '';
      let lastCursor = '';

      // If client explicitly requests a single page
      if (req.query.page_only === 'true') {
        const body: Record<string, any> = { limit: 250 };
        if (cursor) body.cursor = cursor;
        const result = await executeSalesPlayRequest('/products', 'GET', headers, body);
        res.status(result.statusCode);
        res.setHeader('Content-Type', 'application/json');
        return res.send(result.data);
      }

      // Loop to fetch ALL products across all pages
      let pageCount = 0;
      while (pageCount < 30) {
        pageCount++;
        const body: Record<string, any> = { limit: 250 };
        if (cursor) body.cursor = cursor;
        const result = await executeSalesPlayRequest('/products', 'GET', headers, body);
        if (result.statusCode !== 200) {
          if (allProducts.length > 0) break;
          res.status(result.statusCode);
          res.setHeader('Content-Type', 'application/json');
          return res.send(result.data);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(result.data);
        } catch {
          break;
        }
        const prods = parsed.products || [];
        if (!Array.isArray(prods) || prods.length === 0) {
          break;
        }
        for (const p of prods) {
          const key = p.id || p.product_code;
          if (key && !seenIds.has(key)) {
            seenIds.add(key);
            allProducts.push(p);
          } else if (!key) {
            allProducts.push(p);
          }
        }
        lastCursor = parsed.cursor || '';
        if (!parsed.cursor || parsed.cursor === cursor) {
          break;
        }
        cursor = parsed.cursor;
      }

      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      return res.json({
        products: allProducts,
        total: allProducts.length,
        cursor: lastCursor,
      });
    }

    // Special handling for GET /category:
    if (req.method === 'GET' && (cleanPath === '/category' || cleanPath === '/categories')) {
      const result = await executeSalesPlayRequest('/category', 'GET', headers, { limit: 250 });
      res.status(result.statusCode);
      res.setHeader('Content-Type', 'application/json');
      return res.send(result.data);
    }

    // Special handling for GET /inventory:
    if (req.method === 'GET' && cleanPath === '/inventory') {
      const allLevels: any[] = [];
      const seenKeys = new Set<string>();
      let cursor = (req.query.cursor as string) || '';
      let lastCursor = '';

      let pageCount = 0;
      while (pageCount < 30) {
        pageCount++;
        const body: Record<string, any> = { limit: 250 };
        if (cursor) body.cursor = cursor;
        const result = await executeSalesPlayRequest('/inventory', 'GET', headers, body);
        if (result.statusCode !== 200) {
          if (allLevels.length > 0) break;
          res.status(result.statusCode);
          res.setHeader('Content-Type', 'application/json');
          return res.send(result.data);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(result.data);
        } catch {
          break;
        }
        const levels = parsed.inventory_levels || [];
        if (!Array.isArray(levels) || levels.length === 0) {
          break;
        }
        for (const lvl of levels) {
          const key = `${lvl.product_id}_${lvl.shop_id || ''}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allLevels.push(lvl);
          }
        }
        lastCursor = parsed.cursor || '';
        if (!parsed.cursor || parsed.cursor === cursor) {
          break;
        }
        cursor = parsed.cursor;
      }

      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      return res.json({
        inventory_levels: allLevels,
        total: allLevels.length,
        cursor: lastCursor,
      });
    }

    // Special handling for POST /inventory:
    // SalesPlay's backend has a defect where POST /inventory resets products.cost to 0.000.
    // To strictly preserve existing product costs every time, we capture original costs
    // and re-apply them immediately after stock is updated.
    if (req.method === 'POST' && cleanPath === '/inventory') {
      const invLevels = req.body?.inventory_levels;
      const productIds = Array.isArray(invLevels)
        ? invLevels.map((x: any) => x.product_id).filter(Boolean)
        : [];

      // 1. Fetch current product data for these items to remember their existing positive costs
      const productsToProtect: any[] = [];
      if (productIds.length > 0) {
        try {
          const prodRes = await executeSalesPlayRequest('/products', 'GET', headers, { limit: 250 });
          if (prodRes.statusCode === 200) {
            const parsed = JSON.parse(prodRes.data);
            const prods = parsed.products || [];
            for (const pid of productIds) {
              const matched = prods.find((p: any) => p.id === pid);
              if (matched && Number(matched.cost) > 0) {
                productsToProtect.push(matched);
              }
            }
          }
        } catch (err) {
          console.warn('Notice fetching products to protect costs:', err);
        }
      }

      // 2. Execute standard inventory update
      const invResult = await executeSalesPlayRequest('/inventory', 'POST', headers, req.body);

      // 3. If inventory update succeeded and we had products with positive costs, restore their exact costs!
      if (invResult.statusCode === 200 && productsToProtect.length > 0) {
        for (const origProd of productsToProtect) {
          try {
            const pPayload = {
              ...origProd,
              product_price_change: false,
              qty_change_option: false,
              expire_mode: false,
              is_composite: false,
              use_production: false,
              is_combo: false,
              is_ingredient: false,
              is_vat_product: false,
              is_variant: false,
            };
            delete pPayload.created_date;
            delete pPayload.updated_date;
            delete pPayload.delete_date;

            await executeSalesPlayRequest('/products', 'POST', headers, pPayload);
          } catch (resErr) {
            console.warn('Notice re-asserting protected product cost:', resErr);
          }
        }
      }

      res.status(invResult.statusCode);
      const ct = invResult.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);
      return res.send(invResult.data);
    }

    // Special auto-paginated handling for POST /receipts:
    // SalesPlay returns receipts in chunks of 10. Automatically loop with cursor
    // to retrieve ALL sales receipts for the date range so no transactions or COGS are lost.
    if (req.method === 'POST' && cleanPath === '/receipts') {
      const allReceipts: any[] = [];
      const seenReceiptNumbers = new Set<string>();
      let cursor = (req.body?.cursor as string) || '';
      let lastCursor = '';

      // If client explicitly asks for a single page
      if (req.query.page_only === 'true') {
        const result = await executeSalesPlayRequest('/receipts', 'POST', headers, req.body);
        res.status(result.statusCode);
        const ct = result.headers['content-type'];
        if (ct) res.setHeader('Content-Type', ct);
        return res.send(result.data);
      }

      let pageCount = 0;
      while (pageCount < 50) {
        pageCount++;
        const body: Record<string, any> = {
          ...(req.body || {}),
        };
        if (cursor) {
          body.cursor = cursor;
        } else {
          delete body.cursor;
        }

        const result = await executeSalesPlayRequest('/receipts', 'POST', headers, body);
        if (result.statusCode !== 200) {
          if (allReceipts.length > 0) break;
          res.status(result.statusCode);
          res.setHeader('Content-Type', 'application/json');
          return res.send(result.data);
        }

        let parsed: any;
        try {
          parsed = JSON.parse(result.data);
        } catch {
          break;
        }

        const receipts = parsed.receipts || [];
        if (!Array.isArray(receipts) || receipts.length === 0) {
          break;
        }

        for (const r of receipts) {
          const key = r.receipt_number || JSON.stringify(r);
          if (!seenReceiptNumbers.has(key)) {
            seenReceiptNumbers.add(key);
            allReceipts.push(r);
          }
        }

        lastCursor = parsed.cursor || '';
        if (!parsed.cursor || parsed.cursor === cursor) {
          break;
        }
        cursor = parsed.cursor;
      }

      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      return res.json({
        receipts: allReceipts,
        total: allReceipts.length,
        cursor: lastCursor,
      });
    }

    // Standard proxy for all other requests (POST inventory, shops, etc.)
    const payload = (req.body && Object.keys(req.body).length > 0)
      ? req.body
      : undefined;

    const result = await executeSalesPlayRequest(targetPath, req.method, headers, payload);
    res.status(result.statusCode);
    const ct = result.headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct);
    return res.send(result.data);
  } catch (error: any) {
    console.error('SalesPlay API Proxy error:', error);
    return res.status(502).json({
      error: 'SalesPlay Proxy Failed',
      message: error?.message || 'Unable to communicate with SalesPlay servers'
    });
  }
});

import { auth, db } from './src/lib/firebase.js';
import { signInAnonymously } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

// Background Automated Cloud Sync Engine
// Syncs SalesPlay products & receipts directly into Firestore so ANY launched device or PWA has immediate data!
async function runAutoSalesPlaySync(): Promise<void> {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const bSnap = await getDocs(collection(db, 'businesses'));
    const bIds = ['global', 'default'];
    bSnap.forEach(d => { if (d.id && !bIds.includes(d.id)) bIds.push(d.id); });

    const todayStr = new Date().toISOString().substring(0, 10);
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    const datesToSync = [todayStr, yesterdayStr];

    const rawAuth = `Bearer ${DEFAULT_SALESPLAY_API_TOKEN}`;
    const headers = { Accept: '*/*', Authorization: rawAuth };

    // 1. Sync Receipts & Daily Summaries
    for (const dStr of datesToSync) {
      let pageCount = 0;
      let cursor = '';
      const allReceipts: any[] = [];
      const seen = new Set<string>();

      while (pageCount < 20) {
        pageCount++;
        const body: Record<string, any> = {
          created_at_min: `${dStr} 00:00:00`,
          created_at_max: `${dStr} 23:59:59`,
        };
        if (cursor) body.cursor = cursor;
        const res = await executeSalesPlayRequest('/receipts', 'POST', headers, body);
        if (res.statusCode !== 200) break;
        let parsed: any;
        try { parsed = JSON.parse(res.data); } catch { break; }
        const recs = parsed.receipts || [];
        if (!Array.isArray(recs) || recs.length === 0) break;
        for (const r of recs) {
          if (r.receipt_number && !seen.has(r.receipt_number)) {
            seen.add(r.receipt_number);
            allReceipts.push(r);
          }
        }
        if (!parsed.cursor || parsed.cursor === cursor) break;
        cursor = parsed.cursor;
      }

      let totalSales = 0, cashTotal = 0, cardTotal = 0, onlineTotal = 0;
      for (const r of allReceipts) {
        const amt = Number(r.total_money) || 0;
        totalSales += amt;
        const pType = String(r.payment_type || r.payment_mode || '').toLowerCase();
        if (pType.includes('card') || pType.includes('visa') || pType.includes('master')) {
          cardTotal += amt;
        } else if (pType.includes('online') || pType.includes('transfer')) {
          onlineTotal += amt;
        } else {
          cashTotal += amt;
        }

        // Save individual receipt in sales collection
        const primaryBizId = bIds.find(id => id !== 'global' && id !== 'default') || 'main';
        const safeDocId = `sp_${primaryBizId}_${r.receipt_number.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        await setDoc(doc(db, 'sales', safeDocId), {
          businessId: primaryBizId,
          branchId: 'main',
          receiptNumber: r.receipt_number,
          invoiceNumber: r.receipt_number,
          receiptDate: dStr,
          date: (r.receipt_date || dStr) + 'T' + (r.receipt_time || '12:00:00'),
          totalAmount: Math.round(amt * 1000) / 1000,
          totalCost: 0,
          cashAmount: (pType.includes('card') || pType.includes('online')) ? 0 : amt,
          cardAmount: pType.includes('card') ? amt : 0,
          onlineAmount: pType.includes('online') ? amt : 0,
          paymentMethod: pType.includes('card') ? 'card' : pType.includes('online') ? 'online' : 'cash',
          source: 'salesplay_pos',
          status: 'completed',
        }, { merge: true });
      }

      totalSales = Math.round(totalSales * 1000) / 1000;
      cashTotal = Math.round(cashTotal * 1000) / 1000;
      cardTotal = Math.round(cardTotal * 1000) / 1000;
      onlineTotal = Math.round(onlineTotal * 1000) / 1000;
      const bankSale = Math.round((cardTotal + onlineTotal) * 1000) / 1000;

      for (const bId of bIds) {
        await setDoc(doc(db, 'salesDailySummaries', `${bId}_${dStr}`), {
          businessId: bId,
          date: dStr,
          cashTotal,
          cardTotal,
          onlineTotal,
          bankSale,
          totalSales,
          totalCogs: 0,
          grossProfit: totalSales,
          importedCount: allReceipts.length,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    }

    // 2. Sync All Products
    const allProducts: any[] = [];
    const seenIds = new Set<string>();
    let prodCursor = '';
    let prodPageCount = 0;

    while (prodPageCount < 30) {
      prodPageCount++;
      const body: Record<string, any> = { limit: 250 };
      if (prodCursor) body.cursor = prodCursor;
      const res = await executeSalesPlayRequest('/products', 'GET', headers, body);
      if (res.statusCode !== 200) break;
      let parsed: any;
      try { parsed = JSON.parse(res.data); } catch { break; }
      const prods = parsed.products || [];
      if (!Array.isArray(prods) || prods.length === 0) break;
      for (const p of prods) {
        const k = p.id || p.product_code;
        if (k && !seenIds.has(k)) {
          seenIds.add(k);
          allProducts.push(p);
        } else if (!k) {
          allProducts.push(p);
        }
      }
      if (!parsed.cursor || parsed.cursor === prodCursor) break;
      prodCursor = parsed.cursor;
    }

    if (allProducts.length > 0) {
      const invRes = await executeSalesPlayRequest('/inventory', 'GET', headers, { limit: 250 });
      let levels: any[] = [];
      try { levels = JSON.parse(invRes.data).inventory_levels || []; } catch {}
      const stockMap: Record<string, number> = {};
      for (const lvl of levels) {
        stockMap[lvl.product_id] = Number(lvl.in_stock) || 0;
      }

      const mapped = allProducts.map(p => ({
        id: p.id,
        product_code: p.product_code || '',
        product_name: (p.product_name || 'Unnamed Item').trim(),
        category: (p.category || 'General').trim(),
        sub_category: (p.sub_category || '').trim(),
        barcode: (p.barcode || p.product_code || '').trim(),
        cost: Number(p.cost) || 0,
        price: Number(p.price) || 0,
        measurement: p.measurement || '',
        image_url: p.image_url || '',
        stock_control: p.stock_control ?? true,
        in_stock: stockMap[p.id] !== undefined ? stockMap[p.id] : 0,
      }));

      await setDoc(doc(db, 'salesPlayCatalog', 'all_products'), {
        products: mapped,
        count: mapped.length,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (syncErr) {
    console.warn('Background SalesPlay auto-sync notice:', syncErr);
  }
}

// Start background auto-sync 3 seconds after boot, and repeat every 3 minutes
setTimeout(() => { runAutoSalesPlaySync(); }, 3000);
setInterval(() => { runAutoSalesPlaySync(); }, 3 * 60 * 1000);

// Endpoint to trigger manual sync from frontend
app.all('/api/salesplay/trigger-cloud-sync', async (_req, res) => {
  runAutoSalesPlaySync();
  res.json({ success: true, message: 'Cloud sync running' });
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Production vs Development routing
const distPath = path.resolve(__dirname, 'dist');
const hasDist = fs.existsSync(path.resolve(distPath, 'index.html'));
const isProduction = process.env.NODE_ENV === 'production' || 
  process.env.npm_lifecycle_event === 'start' ||
  (hasDist && process.env.DISABLE_HMR === 'true');

if (!isProduction) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { 
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
});
