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

// Helper to make direct HTTPS calls to SalesPlay API with JSON payload support on GET/POST
function executeSalesPlayRequest(
  endpointPath: string,
  method: string,
  headers: Record<string, string>,
  payload?: any
): Promise<{ statusCode: number; headers: Record<string, any>; data: string }> {
  return new Promise((resolve, reject) => {
    const postData = payload !== undefined && payload !== null
      ? (typeof payload === 'string' ? payload : JSON.stringify(payload))
      : '';

    const reqHeaders: Record<string, string> = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(postData));
    }

    const req = https.request(
      {
        hostname: 'api.salesplaypos.com',
        path: `/v1.0${endpointPath}`,
        method,
        headers: reqHeaders,
        timeout: 15000,
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

  const rawAuth = (req.headers.authorization as string) || '';
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };
  if (rawAuth) {
    headers['Authorization'] = rawAuth;
  }

  try {
    const cleanPath = targetPath.split('?')[0];

    // Special auto-paginated handling for GET /products:
    if (req.method === 'GET' && cleanPath === '/products') {
      const allProducts: any[] = [];
      let cursor = (req.query.cursor as string) || '';
      let lastCursor = '';

      // If client explicitly requests a single page
      if (req.query.page_only === 'true') {
        const body: Record<string, any> = { limit: 100 };
        if (cursor) body.cursor = cursor;
        const result = await executeSalesPlayRequest('/products', 'GET', headers, body);
        res.status(result.statusCode);
        res.setHeader('Content-Type', 'application/json');
        return res.send(result.data);
      }

      // Loop to fetch all products across all pages
      while (true) {
        const body: Record<string, any> = { limit: 100 };
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
        allProducts.push(...prods);
        lastCursor = parsed.cursor || '';
        if (!parsed.cursor || prods.length === 0 || parsed.cursor === cursor) {
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
      const result = await executeSalesPlayRequest('/category', 'GET', headers, { limit: 100 });
      res.status(result.statusCode);
      res.setHeader('Content-Type', 'application/json');
      return res.send(result.data);
    }

    // Special handling for GET /inventory:
    if (req.method === 'GET' && cleanPath === '/inventory') {
      const allLevels: any[] = [];
      let cursor = (req.query.cursor as string) || '';
      let lastCursor = '';

      while (true) {
        const body: Record<string, any> = { limit: 100 };
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
        allLevels.push(...levels);
        lastCursor = parsed.cursor || '';
        if (!parsed.cursor || levels.length === 0 || parsed.cursor === cursor) {
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
    const payload = (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0)
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
const isProduction = process.env.NODE_ENV === 'production';

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
  const distPath = path.resolve(__dirname, 'dist');
  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
});
