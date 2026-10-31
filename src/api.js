const express = require('express');

// Read-only for now: the list of topics, and one topic with its replies.
function createApi(db) {
  const api = express.Router();

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
    res.json({ topic, replies });
  });

  return api;
}

module.exports = { createApi };
