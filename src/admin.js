const express = require('express');
const { userFromRequest } = require('./auth');
const { renderMarkdown } = require('./markdown');

const STATUSES = ['open', 'planned', 'fixed'];
const KINDS = { topic: 'topics', reply: 'replies' }; // what the web address says -> table
const STATES = ['visible', 'held', 'deleted'];

// The owner's tools. Every route here is for the owner only (set with OWNER_EMAIL).
function createAdmin(db, ownerEmail, notifier = null) {
  const router = express.Router();

  router.use((req, res, next) => {
    const user = userFromRequest(db, req);
    if (!user) return res.status(401).json({ error: 'Please sign in first.' });
    if (!ownerEmail || user.email !== ownerEmail) return res.status(403).json({ error: 'Only the owner can do this.' });
    req.user = user;
    next();
  });

  // Mark a topic open, planned or fixed.
  router.post('/topic/:id/status', (req, res) => {
    const status = (req.body || {}).status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Pick open, planned or fixed.' });
    const row = db.prepare('UPDATE topics SET status = ? WHERE id = ? RETURNING id').get(status, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'No such topic.' });
    res.json({ ok: true, status });
  });

  // Delete a post, bring a deleted one back, or let a held one through.
  router.post('/:kind/:id/state', (req, res) => {
    const table = KINDS[req.params.kind];
    if (!table) return res.status(404).json({ error: 'No such post.' });
    const state = (req.body || {}).state;
    if (!STATES.includes(state) || state === 'held') return res.status(400).json({ error: 'Pick visible or deleted.' });
    const before = db.prepare(`SELECT state FROM ${table} WHERE id = ?`).get(Number(req.params.id));
    const row = db.prepare(`UPDATE ${table} SET state = ? WHERE id = ? RETURNING id`).get(state, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'No such post.' });
    // A reply the owner lets through is new to its topic's author, so tell them.
    if (notifier && table === 'replies' && before.state === 'held' && state === 'visible') notifier.replyPosted(row.id);
    res.json({ ok: true, state });
  });

  // Flag (hold their posts for review) or block (no posting) a person.
  router.post('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const body = req.body || {};
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'No such person.' });
    if (user.email === ownerEmail) return res.status(400).json({ error: 'You cannot flag or block yourself.' });
    for (const field of ['flagged', 'blocked']) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'boolean') return res.status(400).json({ error: 'Nothing changed.' });
        db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(body[field] ? 1 : 0, id);
      }
    }
    const now = db.prepare('SELECT flagged, blocked FROM users WHERE id = ?').get(id);
    res.json({ flagged: !!now.flagged, blocked: !!now.blocked });
  });

  // Everything the Owner's room shows.
  router.get('/overview', (req, res) => {
    const posts = (state) => {
      const topics = db
        .prepare(
          `SELECT t.id, t.title, t.body, t.label, t.created_at, u.id AS author_id, u.name AS author
           FROM topics t JOIN users u ON u.id = t.user_id WHERE t.state = ? ORDER BY t.id DESC LIMIT 100`
        )
        .all(state)
        .map((t) => ({ kind: 'topic', ...t, body_html: renderMarkdown(t.body), body: undefined }));
      const replies = db
        .prepare(
          `SELECT r.id, r.topic_id, r.body, r.created_at, u.id AS author_id, u.name AS author
           FROM replies r JOIN users u ON u.id = r.user_id WHERE r.state = ? ORDER BY r.id DESC LIMIT 100`
        )
        .all(state)
        .map((r) => ({ kind: 'reply', ...r, body_html: renderMarkdown(r.body), body: undefined }));
      return [...topics, ...replies].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    };
    const users = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.flagged, u.blocked, u.created_at,
                (SELECT COUNT(*) FROM topics t WHERE t.user_id = u.id AND t.state = 'visible')
                + (SELECT COUNT(*) FROM replies r WHERE r.user_id = u.id AND r.state = 'visible') AS posts
         FROM users u ORDER BY u.flagged DESC, u.blocked DESC, u.id DESC LIMIT 500`
      )
      .all()
      .map((u) => ({ ...u, flagged: !!u.flagged, blocked: !!u.blocked, is_owner: u.email === ownerEmail }));
    res.json({ held: posts('held'), deleted: posts('deleted'), users });
  });

  return router;
}

module.exports = { createAdmin };
