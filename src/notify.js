const crypto = require('node:crypto');
const express = require('express');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A secret only this board knows, made once and kept in the database. It signs the
// "turn off reply emails" links so nobody can switch off someone else's emails.
function getSecret(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unsubscribe_secret'").get();
  if (row) return row.value;
  const value = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('unsubscribe_secret', ?)").run(value);
  return value;
}

function createNotifier({ db, mailer, publicUrl }) {
  const secret = getSecret(db);
  const sign = (userId) => crypto.createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('hex');
  const base = publicUrl.replace(/\/+$/, '');

  const unsubscribeUrl = (userId) => `${base}/unsubscribe?u=${userId}&t=${sign(userId)}`;

  // Tell the topic's author that someone replied. Never throws: a failed email must not
  // break posting.
  async function replyPosted(replyId) {
    try {
      const r = db
        .prepare(
          `SELECT r.id, r.body, r.state, r.user_id AS replier_id, ru.name AS replier,
                  t.id AS topic_id, t.title, t.state AS topic_state,
                  tu.id AS author_id, tu.email AS author_email, tu.notify
           FROM replies r
           JOIN topics t ON t.id = r.topic_id
           JOIN users ru ON ru.id = r.user_id
           JOIN users tu ON tu.id = t.user_id
           WHERE r.id = ?`
        )
        .get(replyId);
      if (!r || r.state !== 'visible' || r.topic_state !== 'visible') return;
      if (!r.notify || r.author_id === r.replier_id) return;

      const quote = r.body.length > 500 ? r.body.slice(0, 500) + '…' : r.body;
      await mailer.send({
        to: r.author_email,
        subject: `${r.replier} replied to "${r.title}"`,
        body:
          `${r.replier} replied to your topic "${r.title}":\n\n` +
          quote.replace(/^/gm, '> ') +
          `\n\nSee the conversation: ${base}/board/#/topic/${r.topic_id}\n\n` +
          `--\nYou get this because you started this topic. Turn off reply emails: ${unsubscribeUrl(r.author_id)}`,
      });
    } catch (err) {
      console.error('Could not send a reply email:', err.message);
    }
  }

  // The page the email link opens. It asks first (a button), because some mail programs
  // open every link in an email on their own.
  const router = express.Router();
  const valid = (u, t) => {
    const id = Number(u);
    if (!Number.isInteger(id) || typeof t !== 'string') return null;
    const want = Buffer.from(sign(id));
    const got = Buffer.from(t);
    return got.length === want.length && crypto.timingSafeEqual(got, want) ? id : null;
  };
  const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1f2328}
button{font:inherit;padding:8px 18px;border:1px solid #e0a800;background:#e0a800;border-radius:6px;cursor:pointer;font-weight:600}</style></head>
<body><h1>🍋 ${escapeHtml(title)}</h1>${inner}</body></html>`;

  router.get('/unsubscribe', (req, res) => {
    const id = valid(req.query.u, req.query.t);
    if (!id) return res.status(400).type('html').send(page('Link not valid', '<p>This link is not valid. You can also turn reply emails off after signing in on the board.</p>'));
    res.type('html').send(
      page(
        'Turn off reply emails?',
        `<p>You will stop getting an email when someone replies to your topics.</p>
<form method="post" action="/unsubscribe"><input type="hidden" name="u" value="${id}"><input type="hidden" name="t" value="${escapeHtml(req.query.t)}">
<button type="submit">Yes, turn them off</button></form>`
      )
    );
  });

  router.post('/unsubscribe', express.urlencoded({ extended: false, limit: '1kb' }), (req, res) => {
    const id = valid(req.body && req.body.u, req.body && req.body.t);
    if (!id) return res.status(400).type('html').send(page('Link not valid', '<p>This link is not valid.</p>'));
    db.prepare('UPDATE users SET notify = 0 WHERE id = ?').run(id);
    res.type('html').send(page('Done', '<p>Reply emails are off. You can turn them back on any time from the board, after you sign in.</p>'));
  });

  return { replyPosted, unsubscribeUrl, router };
}

module.exports = { createNotifier };
