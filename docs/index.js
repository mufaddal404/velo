import { Velo } from 'velo-http';
import { staticFiles } from 'velo-http/static';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websitePath = path.resolve(__dirname, 'public');

const app = new Velo();

// Logging middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${ctx.req.method} ${ctx.req.path} - ${ctx.res.getStatus()} (${duration}ms)`);
});

// API Endpoints for the Showcase
app.get('/api/stats', (ctx) => {
  const mem = process.memoryUsage();
  ctx.res.json({
    uptime: process.uptime(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    },
    version: '1.0.0',
    engine: 'Velo'
  });
});

app.get('/api/headers', (ctx) => {
  ctx.res.json(ctx.req.headers);
});

app.get('/api/source', async (ctx) => {
  try {
    const sourcePath = fileURLToPath(import.meta.url);
    const content = await readFile(sourcePath, 'utf8');
    ctx.res.type('text/plain').send(content);
  } catch (e) {
    ctx.res.status(500).send('Error reading source');
  }
});

// Serve the static website folder
app.register(staticFiles, {
  root: websitePath,
  maxAge: 0, // No cache for demo purposes
  index: 'index.html'
});

// SPA Fallback
app.onError(async (err, ctx) => {
  const isGet = ctx.req.method === 'GET';
  const isNotFound = err.name === 'NotFoundError' || err.status === 404;
  const isNotFile = !ctx.req.path.includes('.');
  const isNotApi = !ctx.req.path.startsWith('/api');

  if (isGet && isNotFound && isNotFile && isNotApi) {
    try {
      const indexPath = path.join(websitePath, 'index.html');
      const stats = await stat(indexPath);
      ctx.res.status(200).type('text/html').set('Content-Length', stats.size.toString());
      ctx.res.stream(createReadStream(indexPath));
      return;
    } catch (e) {}
  }

  if (!ctx.res.sent) {
    ctx.res.status(err.status || 500).json({ error: err.message, status: err.status || 500 });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0').then(() => {
  console.log(`
  🚀 Velo Showcase Online
  -----------------------
  Dashboard: http://localhost:${PORT}
  Kernel:    Velo 1.0.0 (Native ESM)
  `);
});

// Graceful Shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Closing...`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
