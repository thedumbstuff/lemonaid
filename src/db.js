const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Opens the database. Pass ':memory:' for a throwaway one (used by the checks).
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'question',
      status TEXT NOT NULL DEFAULT 'open',
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      body TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS votes (
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (topic_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS login_codes (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mailbox (
      id INTEGER PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seedWelcome(db);
  return db;
}

// A first topic so a new board is never empty.
function seedWelcome(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM topics').get().n;
  if (has) return;
  const user = db
    .prepare("INSERT INTO users (email, name) VALUES ('team@lemonaid.local', 'lemonaid') RETURNING id")
    .get();
  const topic = db
    .prepare(
      'INSERT INTO topics (title, body, label, status, user_id) VALUES (?, ?, ?, ?, ?) RETURNING id'
    )
    .get(
      'Welcome to the board!',
      'This is a public space for questions, ideas and problems.\n\nEveryone can read it. Soon you will be able to sign in with just your email and join in.',
      'idea',
      'open',
      user.id
    );
  db.prepare('INSERT INTO replies (topic_id, body, user_id) VALUES (?, ?, ?)').run(
    topic.id,
    'Replies show up right here under the topic.',
    user.id
  );
}

module.exports = { openDb };
