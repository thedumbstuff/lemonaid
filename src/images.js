const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { userFromRequest } = require('./auth');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

// What kind of picture is this? We look at the first bytes, never at what the sender claims.
// (SVG is left out on purpose: it can carry code.)
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function createImages(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const router = express.Router();
  const uploads = []; // [{ user_id, at }] kept in memory; enough for a simple hourly limit

  // Save a picture: the browser sends the raw picture bytes.
  router.post(
    '/',
    express.raw({ type: () => true, limit: MAX_BYTES }),
    (req, res) => {
      const user = userFromRequest(db, req);
      if (!user) return res.status(401).json({ error: 'Please sign in first.' });
      if (user.blocked) return res.status(403).json({ error: 'Your account cannot post here.' });
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'No picture received.' });
      const ext = sniffImage(buf);
      if (!ext) return res.status(400).json({ error: 'Only PNG, JPEG, GIF and WebP pictures can be added.' });

      const now = Date.now();
      while (uploads.length && now - uploads[0].at > HOUR_MS) uploads.shift();
      if (uploads.filter((u) => u.user_id === user.id).length >= MAX_PER_HOUR) {
        return res.status(429).json({ error: 'Too many pictures just now. Please try again later.' });
      }
      uploads.push({ user_id: user.id, at: now });

      const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      db.prepare('INSERT INTO images (filename, user_id, bytes) VALUES (?, ?, ?)').run(name, user.id, buf.length);
      res.status(201).json({ url: `/uploads/${name}` });
    }
  );

  // Friendly message when a picture is too big (instead of a stack trace).
  router.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That picture is too big. The limit is 5 MB.' });
    }
    next(err);
  });

  return router;
}

// Shows saved pictures. Only names we made ourselves are served.
function serveImages(dir) {
  const router = express.Router();
  router.get('/:name', (req, res) => {
    const m = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.exec(req.params.name);
    if (!m) return res.status(404).end();
    const file = path.join(dir, req.params.name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set({
      'Content-Type': TYPES[m[1]],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.sendFile(file);
  });
  return router;
}

module.exports = { createImages, serveImages, sniffImage };
