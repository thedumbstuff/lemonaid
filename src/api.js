const express = require('express');
const { userFromRequest } = require('./auth');
const { renderMarkdown } = require('./markdown');
const { checkText } = require('./moderation');

const LABELS = ['bug', 'idea', 'question'];
const MAX_TITLE = 120;
const MAX_BODY = 10000;

function createApi(db, ownerEmail = '', notifier = null, ai = null, topicsPerDay = 5) {
  const isOwner = (user) => !!user && !!ownerEmail && user.email === ownerEmail;
  const api = express.Router();

  // Shows a post's text as safe HTML.
  const withHtml = (row) => ({ ...row, body_html: renderMarkdown(row.body), body: undefined });

  // Middleware: only signed-in people may continue.
  function needSignIn(req, res, next) {
    const user = userFromRequest(db, req);
    if (!user) return res.status(401).json({ error: 'Please sign in first.' });
    req.user = user;
    next();
  }

  // Like needSignIn, but also refuses people the owner has blocked. Used for anything that writes.
  function needCanWrite(req, res, next) {
    needSignIn(req, res, () => {
      if (req.user.blocked) return res.status(403).json({ error: 'Your account cannot post here.' });
      next();
    });
  }

  // People the owner has flagged have their posts held for the owner to look at first.
  const stateFor = (user) => (user.flagged && !isOwner(user) ? 'held' : 'visible');

  // Decides if a new post is published or held, and why. The owner's own posts always go
  // straight through. The AI check (when the owner switched it on) only looks at posts
  // that passed everything else.
  async function decide(user, ...parts) {
    const state = stateFor(user);
    if (state === 'held') return { state, reason: 'Written by a person you flagged.' };
    if (ai && ai.enabled() && !isOwner(user)) {
      const verdict = await ai.check(...parts);
      if (verdict.hold) return { state: 'held', reason: 'AI check: ' + verdict.reason };
    }
    return { state: 'visible', reason: null };
  }

  // Checks the text of a post. Returns an error message, or null when fine.
  function bodyProblem(body) {
    if (typeof body !== 'string' || !body.trim()) return 'Please write something.';
    if (body.length > MAX_BODY) return `That is too long (the limit is ${MAX_BODY} characters).`;
    return null;
  }

  const STATUSES = ['open', 'planned', 'fixed'];

  // A short plain-text line for the topic list, like the last message under a chat's name.
  function snippet(md, max = 90) {
    const text = String(md || '')
      .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' 📷 Picture ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~#>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }

  // The board: sort=top (most wanted), new (newest topics) or active (latest message first);
  // optional label= and status= filters. Each topic comes with its latest message.
  api.get('/topics', (req, res) => {
    const me = userFromRequest(db, req);
    const where = ["t.state = 'visible'"];
    const args = [me ? me.id : 0];
    if (LABELS.includes(req.query.label)) { where.push('t.label = ?'); args.push(req.query.label); }
    if (STATUSES.includes(req.query.status)) { where.push('t.status = ?'); args.push(req.query.status); }
    const order = req.query.sort === 'new'
      ? 't.created_at DESC, t.id DESC'
      : req.query.sort === 'active'
        ? 'last_at DESC, t.id DESC'
        : 'vote_count DESC, t.created_at DESC, t.id DESC';
    const topics = db
      .prepare(
        `SELECT t.id, t.title, t.label, t.status, t.created_at, u.name AS author, t.body,
                lr.body AS last_body, lu.name AS last_author, lr.created_at AS last_reply_at,
                COALESCE(lr.created_at, t.created_at) AS last_at,
                (SELECT COUNT(*) FROM replies r WHERE r.topic_id = t.id AND r.state = 'visible') AS reply_count,
                (SELECT COUNT(*) FROM votes v WHERE v.topic_id = t.id) AS vote_count,
                EXISTS (SELECT 1 FROM votes v WHERE v.topic_id = t.id AND v.user_id = ?) AS voted
         FROM topics t JOIN users u ON u.id = t.user_id
         LEFT JOIN replies lr ON lr.id = (
           SELECT r.id FROM replies r WHERE r.topic_id = t.id AND r.state = 'visible' ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
         LEFT JOIN users lu ON lu.id = lr.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${order}`
      )
      .all(...args)
      .map(({ body, last_body, last_author, last_reply_at, ...t }) => ({
        ...t,
        voted: !!t.voted,
        last: last_reply_at
          ? { author: last_author, text: snippet(last_body), at: last_reply_at }
          : { author: t.author, text: snippet(body), at: t.created_at },
      }));
    res.json({ topics });
  });

  // Upvote a topic, or take your upvote back (one per person per topic).
  api.post('/topics/:id/vote', needCanWrite, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT id FROM topics WHERE id = ? AND state = 'visible'").get(id)) return res.status(404).json({ error: 'No such topic.' });
    const had = db.prepare('DELETE FROM votes WHERE topic_id = ? AND user_id = ? RETURNING 1').get(id, req.user.id);
    if (!had) db.prepare('INSERT INTO votes (topic_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE topic_id = ?').get(id).n;
    res.json({ voted: !had, vote_count: count });
  });

  api.get('/topics/:id', (req, res) => {
    const id = Number(req.params.id);
    const me = userFromRequest(db, req);
    const topic = db
      .prepare(
        `SELECT t.id, t.title, t.body, t.label, t.status, t.created_at, u.name AS author, u.id AS author_id, u.email AS author_email
         FROM topics t JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.state = 'visible'`
      )
      .get(id);
    if (!topic) return res.status(404).json({ error: 'No such topic.' });
    const replies = db
      .prepare(
        `SELECT r.id, r.body, r.created_at, u.name AS author, u.id AS author_id, u.email AS author_email
         FROM replies r JOIN users u ON u.id = r.user_id
         WHERE r.topic_id = ? AND r.state = 'visible' ORDER BY r.created_at, r.id`
      )
      .all(id);
    topic.vote_count = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE topic_id = ?').get(id).n;
    topic.voted = !!(me && db.prepare('SELECT 1 FROM votes WHERE topic_id = ? AND user_id = ?').get(id, me.id));
    // Who wrote a post is only for the owner's tools (to flag or block them). Everyone is told
    // which posts are their own and which are the owner's, never anyone's email.
    const forMe = ({ author_email, ...row }) => ({
      ...row,
      author_id: isOwner(me) ? row.author_id : undefined,
      mine: !!me && row.author_id === me.id,
      by_owner: !!ownerEmail && author_email === ownerEmail,
    });
    res.json({ topic: forMe(withHtml(topic)), replies: replies.map(withHtml).map(forMe) });
  });

  // Start a topic.
  api.post('/topics', needCanWrite, async (req, res) => {
    const { title, body, label } = req.body || {};
    const cleanTitle = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
    if (cleanTitle.length < 3) return res.status(400).json({ error: 'Please give your topic a title (at least 3 letters).' });
    if (cleanTitle.length > MAX_TITLE) return res.status(400).json({ error: `The title is too long (the limit is ${MAX_TITLE} characters).` });
    if (!LABELS.includes(label)) return res.status(400).json({ error: 'Please pick a label: bug, idea or question.' });
    const problem = bodyProblem(body);
    if (problem) return res.status(400).json({ error: problem });
    // Each person may start a limited number of topics in any 24 hours (the owner has no limit).
    // Held and deleted topics count too, so deleting does not make room for more spam.
    if (!isOwner(req.user)) {
      const recent = db
        .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM topics WHERE user_id = ? AND created_at > datetime('now', '-1 day')")
        .get(req.user.id);
      if (recent.n >= topicsPerDay) {
        const freeAt = new Date(recent.oldest.replace(' ', 'T') + 'Z').getTime() + 24 * 60 * 60 * 1000;
        const hours = Math.max(1, Math.ceil((freeAt - Date.now()) / (60 * 60 * 1000)));
        return res.status(429).json({
          error: `You can start ${topicsPerDay} topics a day. You can start another one in about ${hours} hour${hours === 1 ? '' : 's'}. Replying is still open.`,
        });
      }
    }
    const verdict = checkText(cleanTitle, body);
    if (!verdict.ok) return res.status(422).json({ error: verdict.reason });

    const { state, reason } = await decide(req.user, cleanTitle, body);
    const row = db
      .prepare('INSERT INTO topics (title, body, label, user_id, state, hold_reason) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .get(cleanTitle, body.trim(), label, req.user.id, state, reason);
    res.status(201).json({ id: row.id, held: state === 'held' });
  });

  // Reply to a topic.
  api.post('/topics/:id/replies', needCanWrite, async (req, res) => {
    const id = Number(req.params.id);
    const topic = db.prepare("SELECT id FROM topics WHERE id = ? AND state = 'visible'").get(id);
    if (!topic) return res.status(404).json({ error: 'No such topic.' });
    const problem = bodyProblem((req.body || {}).body);
    if (problem) return res.status(400).json({ error: problem });
    const verdict = checkText(req.body.body);
    if (!verdict.ok) return res.status(422).json({ error: verdict.reason });

    const { state, reason } = await decide(req.user, req.body.body);
    const row = db
      .prepare('INSERT INTO replies (topic_id, body, user_id, state, hold_reason) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(id, req.body.body.trim(), req.user.id, state, reason);
    if (notifier && state === 'visible') notifier.replyPosted(row.id);
    res.status(201).json({ id: row.id, held: state === 'held' });
  });

  // Shows how a piece of text will look once posted (the preview).
  api.post('/preview', (req, res) => {
    const body = (req.body || {}).body;
    if (typeof body !== 'string' || body.length > MAX_BODY) return res.status(400).json({ error: 'Nothing to preview.' });
    res.json({ html: renderMarkdown(body) });
  });

  return api;
}

module.exports = { createApi };
