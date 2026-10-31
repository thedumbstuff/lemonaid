const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { createApi } = require('./api');
const { createAuth } = require('./auth');
const { createMailer } = require('./mailer');
const { createImages, serveImages } = require('./images');
const { createAdmin } = require('./admin');
const { createNotifier } = require('./notify');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// options.dbFile: where to keep the data (default: data/lemonaid.db, or ':memory:' in checks).
// options.ownerEmail: who runs this board (default: OWNER_EMAIL; in try-out mode owner@lemonaid.local).
// options.publicUrl: the web address of this board, used in emails (default: PUBLIC_URL, or http://localhost:3000).
// options.smtpUrl, options.mailFrom, options.mailTransport: how to send real email (see mailer.js).
// options.testMailbox: show the test mailbox page (default: on, except in production).
function createApp(options = {}) {
  const app = express();
  const pub = path.join(__dirname, '..', 'public');
  const dbFile = options.dbFile || path.join(__dirname, '..', 'data', 'lemonaid.db');
  const db = openDb(dbFile);
  const tryOutMode = options.testMailbox ?? process.env.NODE_ENV !== 'production';
  const mailer = createMailer(db, { smtpUrl: options.smtpUrl, mailFrom: options.mailFrom, transport: options.mailTransport, tryOutMode });
  const publicUrl = options.publicUrl || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const notifier = createNotifier({ db, mailer, publicUrl });
  const configuredOwner = (options.ownerEmail || process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const usingDemoOwner = !configuredOwner && tryOutMode;
  const ownerEmail = configuredOwner || (usingDemoOwner ? 'owner@lemonaid.local' : '');
  app.locals.db = db;

  const imagesDir = options.imagesDir || path.join(__dirname, '..', 'data', 'images');
  // Pictures are read before the general JSON reader, which would not understand them.
  app.use('/api/images', createImages(db, imagesDir));
  app.use('/uploads', serveImages(imagesDir));

  app.use(notifier.router); // the "turn off reply emails" page
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/auth', createAuth(db, mailer, ownerEmail));
  app.use('/api/admin', createAdmin(db, ownerEmail, notifier));
  // Only in try-out mode: tells the demo page which email to use to try the owner's tools.
  app.get('/api/config', (req, res) => res.json({ demoOwnerEmail: usingDemoOwner ? ownerEmail : null }));
  app.use('/api', createApi(db, ownerEmail, notifier));

  // The test mailbox: shows the emails Lemonaid "sent", so you can try sign-in without an
  // email account. Never shown in production.
  const showMailbox = tryOutMode;
  if (showMailbox) {
    app.get('/mailbox', (req, res) => {
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

  // The demo website (what an owner's own site would look like).
  app.use('/', express.static(path.join(pub, 'demo')));
  // The board itself, shown inside a frame on the owner's site.
  app.use('/board', express.static(path.join(pub, 'board')));
  // The one line an owner adds to their site: /lemonaid.js
  app.get('/lemonaid.js', (req, res) => {
    res.type('application/javascript').sendFile(path.join(pub, 'lemonaid.js'));
  });
  return app;
}

module.exports = { createApp };
