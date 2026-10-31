const crypto = require('node:crypto');
const express = require('express');

const CODE_LIFETIME_MS = 10 * 60 * 1000; // a code works for 10 minutes
const MAX_WRONG_TRIES = 5;
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
const MAX_CODES_PER_IP_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const codeHash = (email, code) => sha(`${email}:${code}`);

function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// "Ana.Smith+news@x.com" -> "ana.smith": a short public name that hides the address.
function nameFromEmail(email) {
  const local = email.split('@')[0].split('+')[0].replace(/[^a-z0-9._-]/g, '');
  return local.slice(0, 20) || 'visitor';
}

// Looks at the "Authorization: Bearer <token>" header and finds the signed-in person.
function userFromRequest(db, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.get('authorization') || '');
  if (!m) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(sha(m[1])) || null
  );
}

function createAuth(db, mailer) {
  const router = express.Router();
  const ipHits = new Map(); // ip -> times a code was asked for in the last hour

  function ipTooBusy(ip) {
    const now = Date.now();
    const hits = (ipHits.get(ip) || []).filter((t) => now - t < HOUR_MS);
    if (hits.length >= MAX_CODES_PER_IP_PER_HOUR) {
      ipHits.set(ip, hits);
      return true;
    }
    hits.push(now);
    ipHits.set(ip, hits);
    return false;
  }

  // Step 1: ask for a code.
  router.post('/request-code', (req, res) => {
    const email = cleanEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Please type a valid email address.' });
    if (ipTooBusy(req.ip)) {
      return res.status(429).json({ error: 'Too many tries. Please wait a while and try again.' });
    }
    const now = Date.now();
    const recent = db
      .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?')
      .get(email, now - HOUR_MS).n;
    if (recent >= MAX_CODES_PER_EMAIL_PER_HOUR) {
      return res.status(429).json({ error: 'Too many codes asked for this email. Please try again in an hour.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    // Only the newest code works (verify looks at the newest). Old rows stay for an hour so the limit above can count them.
    db.prepare('DELETE FROM login_codes WHERE created_at < ?').run(now - HOUR_MS);
    db.prepare(
      'INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, codeHash(email, code), now + CODE_LIFETIME_MS, now);
    mailer.send({
      to: email,
      subject: `Your Lemonaid code: ${code}`,
      body: `Your sign-in code is ${code}\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`,
    });
    res.json({ ok: true });
  });

  // Step 2: type the code.
  router.post('/verify-code', (req, res) => {
    const email = cleanEmail(req.body && req.body.email);
    const code = req.body && typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Please type the 6-digit code.' });
    }
    const row = db.prepare('SELECT * FROM login_codes WHERE email = ? ORDER BY id DESC LIMIT 1').get(email);
    const bad = { error: 'That code is not right. Check it and try again, or ask for a new one.' };
    if (!row || row.expires_at < Date.now() || row.attempts >= MAX_WRONG_TRIES) {
      return res.status(400).json({ error: 'That code has expired. Please ask for a new one.' });
    }
    const given = Buffer.from(codeHash(email, code));
    const wanted = Buffer.from(row.code_hash);
    if (!crypto.timingSafeEqual(given, wanted)) {
      db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      return res.status(400).json(bad);
    }
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);

    let user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
    if (!user) {
      user = db
        .prepare('INSERT INTO users (email, name) VALUES (?, ?) RETURNING id, email, name')
        .get(email, nameFromEmail(email));
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(
      sha(token),
      user.id,
      Date.now()
    );
    res.json({ token, user: { name: user.name } });
  });

  router.post('/logout', (req, res) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.get('authorization') || '');
    if (m) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(m[1]));
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const user = userFromRequest(db, req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: { name: user.name } });
  });

  return router;
}

module.exports = { createAuth, userFromRequest };
