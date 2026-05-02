const http = require('http');
const { queryChatHistory } = require('../services/chatHistoryProjectionService');

const allowedOrigins = String(
  process.env.CORS_ALLOWED_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173,https://front.team9.cloud.skala-ai.com'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(text);
}

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (!origin) {
    return;
  }

  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
}

function createChatHistoryServer({ port, drainingRef }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/health') {
      sendJson(res, drainingRef.value ? 503 : 200, { ok: !drainingRef.value });
      return;
    }

    const match = pathname.match(/^\/chat-history\/owners\/([^/]+)\/users\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      try {
        const ownerUserId = decodeURIComponent(match[1]);
        const targetUserId = decodeURIComponent(match[2]);
        const before = url.searchParams.get('before') || undefined;
        const limit = url.searchParams.get('limit') || undefined;

        if (!ownerUserId || !targetUserId) {
          sendJson(res, 400, { message: 'ownerUserId and targetUserId are required' });
          return;
        }

        const payload = await queryChatHistory({
          ownerUserId,
          targetUserId,
          before,
          limit,
        });
        sendJson(res, 200, payload);
      } catch (error) {
        console.error('[http] chat history query failed:', error);
        sendJson(res, 500, {
          message: 'failed to query chat history',
          error: error.message,
        });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      sendJson(res, 200, { ok: true, service: 'chat-history-consumer' });
      return;
    }

    sendText(res, 404, 'Not Found');
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(port, () => resolve());
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = {
  createChatHistoryServer,
};
