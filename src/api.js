const express = require('express');
const { userFromRequest } = require('./auth');
const { renderMarkdown } = require('./markdown');

const LABELS = ['bug', 'idea', 'question'];
const MAX_TITLE = 120;
const MAX_BODY = 10000;

function createApi(db) {
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

  // Checks the text of a post. Returns an error message, or null when fine.
  function bodyProblem(body) {
    if (typeof body !== 'string' || !body.trim()) return 'Please write something.';
    if (body.length > MAX_BODY) return `That is too long (the limit is ${MAX_BODY} characters).`;
    return null;
  }

  api.get('/topics', (req, res) => {
    const topics = db
      .prepare(
        `SELECT t.id, t.title, t.label, t.status, t.created_at, u.name AS author,
                (SELECT COUNT(*) FROM replies r WHERE r.topic_id = t.id) AS reply_count
         FROM topics t JOIN users u ON u.id = t.user_id
         ORDER BY t.created_at DESC, t.id DESC`
      )
      .all();
    res.json({ topics });
  });

  api.get('/topics/:id', (req, res) => {
    const id = Number(req.params.id);
    const topic = db
      .prepare(
        `SELECT t.id, t.title, t.body, t.label, t.status, t.created_at, u.name AS author
         FROM topics t JOIN users u ON u.id = t.user_id WHERE t.id = ?`
      )
      .get(id);
    if (!topic) return res.status(404).json({ error: 'No such topic.' });
    const replies = db
      .prepare(
        `SELECT r.id, r.body, r.created_at, u.name AS author
         FROM replies r JOIN users u ON u.id = r.user_id
         WHERE r.topic_id = ? ORDER BY r.created_at, r.id`
      )
      .all(id);
    res.json({ topic: withHtml(topic), replies: replies.map(withHtml) });
  });

  // Start a topic.
  api.post('/topics', needSignIn, (req, res) => {
    const { title, body, label } = req.body || {};
    const cleanTitle = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
    if (cleanTitle.length < 3) return res.status(400).json({ error: 'Please give your topic a title (at least 3 letters).' });
    if (cleanTitle.length > MAX_TITLE) return res.status(400).json({ error: `The title is too long (the limit is ${MAX_TITLE} characters).` });
    if (!LABELS.includes(label)) return res.status(400).json({ error: 'Please pick a label: bug, idea or question.' });
    const problem = bodyProblem(body);
    if (problem) return res.status(400).json({ error: problem });

    const row = db
      .prepare('INSERT INTO topics (title, body, label, user_id) VALUES (?, ?, ?, ?) RETURNING id')
      .get(cleanTitle, body.trim(), label, req.user.id);
    res.status(201).json({ id: row.id });
  });

  // Reply to a topic.
  api.post('/topics/:id/replies', needSignIn, (req, res) => {
    const id = Number(req.params.id);
    const topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(id);
    if (!topic) return res.status(404).json({ error: 'No such topic.' });
    const problem = bodyProblem((req.body || {}).body);
    if (problem) return res.status(400).json({ error: problem });

    const row = db
      .prepare('INSERT INTO replies (topic_id, body, user_id) VALUES (?, ?, ?) RETURNING id')
      .get(id, req.body.body.trim(), req.user.id);
    res.status(201).json({ id: row.id });
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
