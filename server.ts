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
  let targetPath = (req.originalUrl || req.url).replace(/^\/api\/salesplay/, '');
  if (!targetPath || targetPath === '') targetPath = '/';

  // Normalize /categories to /category
  if (targetPath.startsWith('/categories')) {
    targetPath = targetPath.replace(/^\/categories/, '/category');
  }

  const rawAuth = (req.headers.authorization as string) || `Bearer ${DEFAULT_SALESPLAY_API_TOKEN}`;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: rawAuth.startsWith('Bearer ') ? rawAuth : `Bearer ${rawAuth}`,
  };

  try {
    const cleanPath = targetPath.split('?')[0];

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

    // Standard proxy for all other requests (POST receipts, POST inventory, shops, etc.)
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
