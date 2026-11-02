const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { createApi } = require('./api');
const { createAuth } = require('./auth');
const { createMailer } = require('./mailer');
const { createImages, serveImages } = require('./images');
const { createAdmin } = require('./admin');
const { createNotifier } = require('./notify');
const { createAiCheck } = require('./ai');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// options.dataDir: the folder for the database and pictures (default: DATA_DIR, or ./data).
// options.accent: the board's main colour as a hex code (default: ACCENT_COLOR).
// options.dbFile: where to keep the data (default: data/lemonaid.db, or ':memory:' in checks).
// options.ownerEmail: who runs this board (default: OWNER_EMAIL; in try-out mode owner@lemonaid.local).
// options.publicUrl: the web address of this board, used in emails (default: PUBLIC_URL, or http://localhost:3000).
// options.smtpUrl, options.mailFrom, options.mailTransport: how to send real email (see mailer.js).
// options.aiClient: a ready-made Anthropic client (for the checks); otherwise ANTHROPIC_API_KEY is used.
// options.topicsPerDay: topics one person may start in any 24 hours (default: TOPICS_PER_DAY, or 5).
// options.testMailbox: show the test mailbox page (default: on, except in production).
// "#e0a800", "e0a800" or "#0a8" -> "e0a800" / "00aa88"; anything else -> null.
function hexColour(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
}

function createApp(options = {}) {
  const app = express();
  const pub = path.join(__dirname, '..', 'public');
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const dbFile = options.dbFile || path.join(dataDir, 'lemonaid.db');
  const db = openDb(dbFile);
  const tryOutMode = options.testMailbox ?? process.env.NODE_ENV !== 'production';
  const mailer = createMailer(db, { smtpUrl: options.smtpUrl, mailFrom: options.mailFrom, transport: options.mailTransport, tryOutMode });
  const publicUrl = options.publicUrl || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const notifier = createNotifier({ db, mailer, publicUrl });
  const ai = createAiCheck({ db, client: options.aiClient, model: options.aiModel });
  const configuredOwner = (options.ownerEmail || process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const usingDemoOwner = !configuredOwner && tryOutMode;
  const ownerEmail = configuredOwner || (usingDemoOwner ? 'owner@lemonaid.local' : '');
  app.locals.db = db;

  // Behind a reverse proxy (nginx, Caddy, Traefik...) set TRUST_PROXY=1 so the limits on
  // sign-in codes count each visitor's own address, not the proxy's.
  const proxy = options.trustProxy ?? process.env.TRUST_PROXY;
  if (proxy) app.set('trust proxy', /^\d+$/.test(String(proxy)) ? Number(proxy) : proxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  const imagesDir = options.imagesDir || path.join(dataDir, 'images');
  // Pictures are read before the general JSON reader, which would not understand them.
  app.use('/api/images', createImages(db, imagesDir));
  app.use('/uploads', serveImages(imagesDir));

  app.use(notifier.router); // the "turn off reply emails" page
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/auth', createAuth(db, mailer, ownerEmail));
  app.use('/api/admin', createAdmin(db, ownerEmail, notifier, ai));
  // Only in try-out mode: tells the demo page which email to use to try the owner's tools.
  const accent = hexColour(options.accent ?? process.env.ACCENT_COLOR);
  app.get('/api/config', (req, res) => res.json({ demoOwnerEmail: usingDemoOwner ? ownerEmail : null, accent }));
  // How many topics one person may start in any 24 hours (default 5).
  const perDay = Number(options.topicsPerDay ?? process.env.TOPICS_PER_DAY ?? 5);
  const topicsPerDay = Number.isInteger(perDay) && perDay > 0 ? perDay : 5;
  app.use('/api', createApi(db, ownerEmail, notifier, ai, topicsPerDay));

  // The test mailbox: shows the emails Lemonaid "sent", so you can try sign-in without an
  // email account. Never shown in production.
  // Extra safety in case someone forgets NODE_ENV=production: the test mailbox (which shows
  // sign-in codes, including the demo owner's) only opens for someone sitting at this
  // computer, never through a proxy or from the internet.
  const fromThisComputer = (req) => {
    const ip = req.socket.remoteAddress || '';
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    return local && !req.get('x-forwarded-for') && !req.get('forwarded') && !req.get('x-real-ip');
  };
  const showMailbox = tryOutMode && mailer.mode === 'test-mailbox';
  if (showMailbox) {
    app.get('/mailbox', (req, res, next) => {
      if (!fromThisComputer(req)) return next();
      const mails = db.prepare('SELECT * FROM mailbox ORDER BY id DESC LIMIT 50').all();
      const items = mails
        .map(
          (m) =>
            `<article><h3>${escapeHtml(m.subject)}</h3><p class="to">To: ${escapeHtml(m.to_email)} · ${escapeHtml(m.created_at)} UTC</p><pre>${escapeHtml(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</pre></article>`
        )
        .join('');
      res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lemonaid test mailbox</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#1f2328}
article{border:1px solid #e5e7eb;border-radius:8px;padding:4px 14px;margin:12px 0}h3{margin:10px 0 0}
.to{color:#6b7280;font-size:.85rem;margin:2px 0}pre{white-space:pre-wrap;font:inherit}</style></head>
<body><h1>🍋 Test mailbox</h1><p>Emails Lemonaid sends show up here while you try it out. <a href="">Refresh</a></p>
${items || '<p>No emails yet.</p>'}</body></html>`);
    });
  }

  // The demo website (what an owner's own site would look like), while trying it out.
  // Online the board's own address opens the board: visitors who follow a link from an
  // email, or type the address, should not land on a pretend product website.
  if (tryOutMode) app.use('/', express.static(path.join(pub, 'demo')));
  else app.get('/', (req, res) => res.redirect(302, '/board/'));
  // The board itself, shown inside a frame on the owner's site.
  // The board only runs its own files: even if harmful code slipped into a post, the
  // browser would refuse to run it. Any site may show the board in a frame (that is the point).
  app.use('/board', (req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors *"
    );
    next();
  });
  app.use('/board', express.static(path.join(pub, 'board')));
  // The one line an owner adds to their site: /lemonaid.js
  app.get('/lemonaid.js', (req, res) => {
    res.type('application/javascript').sendFile(path.join(pub, 'lemonaid.js'));
  });
  // Unknown addresses and errors: a short plain answer, never the program's insides.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message =
      err.type === 'entity.too.large' ? 'That is too big to send.'
      : err.type === 'entity.parse.failed' ? 'That request could not be read.'
      : status < 500 ? 'That request could not be handled.'
      : 'Something went wrong on our side. Please try again.';
    if (res.headersSent) return next(err);
    res.status(status).json({ error: message });
  });
  return app;
}

module.exports = { createApp };
