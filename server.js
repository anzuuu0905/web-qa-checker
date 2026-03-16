// ===========================================
// server.js - Web QA Checker Public Server
// Rate-limited & memory-optimized for Render.com free tier
// ===========================================
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import ejs from 'ejs';
import { runWebChecks } from './web-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3200;

// State: active checks
const activeChecks = new Map();

// ===== Rate Limiting =====
const rateLimit = new Map(); // IP -> timestamp
const RATE_LIMIT_MS = 60 * 1000; // 1 minute between checks per IP
let currentlyRunning = 0;
const MAX_CONCURRENT = 1; // Only 1 check at a time (512MB memory)

function checkRateLimit(ip) {
  const lastCheck = rateLimit.get(ip);
  if (lastCheck && Date.now() - lastCheck < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastCheck)) / 1000);
    return { limited: true, waitSec };
  }
  return { limited: false };
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of rateLimit.entries()) {
    if (now - timestamp > RATE_LIMIT_MS * 2) {
      rateLimit.delete(ip);
    }
  }
  // Cleanup old checks (older than 30 minutes)
  for (const [id, check] of activeChecks.entries()) {
    if (now - check.startedAt > 30 * 60 * 1000) {
      activeChecks.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Trust proxy (for Render.com)
app.set('trust proxy', true);

// Serve generated report screenshots
app.use('/reports/screenshots', express.static(join(__dirname, 'data', 'screenshots')));

// ===== Health Check (for Render.com) =====
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', running: currentlyRunning });
});

// ===== API Routes =====

/**
 * POST /api/check — Start a new QA check
 * Body: { url: string, siteName?: string }
 */
app.post('/api/check', (req, res) => {
  const { url, siteName } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!url) {
    return res.status(400).json({ error: 'URLは必須です' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: '有効なURLを入力してください' });
  }

  // Block localhost / private IPs
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
      return res.status(400).json({ error: 'ローカルアドレスはチェックできません' });
    }
  } catch { /* skip */ }

  // Rate limit check
  const limit = checkRateLimit(clientIp);
  if (limit.limited) {
    return res.status(429).json({ error: `レート制限中です。${limit.waitSec}秒後に再試行してください` });
  }

  // Concurrency check
  if (currentlyRunning >= MAX_CONCURRENT) {
    return res.status(503).json({ error: '現在別のチェックが実行中です。しばらくお待ちください' });
  }

  const id = uuidv4();
  const reportDir = join(__dirname, 'data', 'reports');
  const screenshotDir = join(__dirname, 'data', 'screenshots');

  // Record rate limit
  rateLimit.set(clientIp, Date.now());
  currentlyRunning++;

  // Initialize check state
  activeChecks.set(id, {
    status: 'running',
    url,
    siteName: siteName || null,
    events: [],
    report: null,
    startedAt: Date.now(),
  });

  // Run checks in background
  const emit = (type, message) => {
    const event = { type, message, timestamp: Date.now() };
    const check = activeChecks.get(id);
    if (check) {
      check.events.push(event);
    }
  };

  runWebChecks({ url, siteName, reportDir, screenshotDir, emit })
    .then(report => {
      // Generate HTML report
      const templatePath = join(__dirname, 'templates', 'report.html');
      const template = readFileSync(templatePath, 'utf-8');
      const html = ejs.render(template, {
        report,
        formatDate, statusIcon, statusColor, statusLabel, calculateScore, linkify,
      });

      // Save report HTML
      if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
      const reportPath = join(reportDir, `${id}.html`);
      writeFileSync(reportPath, html, 'utf-8');

      const check = activeChecks.get(id);
      if (check) {
        check.status = 'done';
        check.report = report;
        check.events.push({ type: 'done', message: 'チェック完了', timestamp: Date.now() });
      }
    })
    .catch(err => {
      const check = activeChecks.get(id);
      if (check) {
        check.status = 'error';
        check.error = err.message;
        check.events.push({ type: 'error', message: err.message, timestamp: Date.now() });
      }
    })
    .finally(() => {
      currentlyRunning--;
    });

  res.json({ id });
});

/**
 * GET /api/status/:id — SSE stream for check progress
 */
app.get('/api/status/:id', (req, res) => {
  const { id } = req.params;
  const check = activeChecks.get(id);

  if (!check) {
    return res.status(404).json({ error: 'チェックが見つかりません' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let lastIndex = 0;

  const interval = setInterval(() => {
    const check = activeChecks.get(id);
    if (!check) {
      clearInterval(interval);
      res.end();
      return;
    }

    // Send new events
    while (lastIndex < check.events.length) {
      const event = check.events[lastIndex];
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      lastIndex++;
    }

    // End if done or error
    if (check.status === 'done' || check.status === 'error') {
      if (check.status === 'done') {
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          message: 'レポート生成完了',
          reportUrl: `/reports/${id}`,
          summary: check.report?.summary,
          timestamp: Date.now(),
        })}\n\n`);
      }
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

/**
 * GET /reports/:id — View generated report
 */
app.get('/reports/:id', (req, res) => {
  const { id } = req.params;
  const reportPath = join(__dirname, 'data', 'reports', `${id}.html`);

  if (!existsSync(reportPath)) {
    return res.status(404).send('レポートが見つかりません');
  }

  res.sendFile(reportPath);
});

/**
 * GET /check/:id — Progress page
 */
app.get('/check/:id', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'check.html'));
});

// ===== Helper functions (from reporter.js) =====

function formatDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusIcon(status) {
  return { pass: '✅', fail: '❌', warn: '⚠️', manual: '👁️' }[status] || '❓';
}

function statusColor(status) {
  return { pass: '#10b981', fail: '#ef4444', warn: '#f59e0b', manual: '#6366f1' }[status] || '#6b7280';
}

function statusLabel(status) {
  return { pass: '合格', fail: '不合格', warn: '警告', manual: '手動確認' }[status] || '不明';
}

function calculateScore(summary) {
  const checkable = summary.total - summary.manual;
  if (checkable === 0) return 100;
  return Math.round((summary.pass / checkable) * 100);
}

function linkify(text) {
  if (!text) return '';
  return text.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// ===== Start Server =====

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔍 Web QA Checker Public`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Max concurrent: ${MAX_CONCURRENT}`);
  console.log(`   Rate limit: ${RATE_LIMIT_MS / 1000}s per IP\n`);
});
