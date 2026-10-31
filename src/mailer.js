// Sends email. For now every email goes to the "test mailbox" (a table you can read at
// /mailbox), so everything can be tried without an email account. Real sending comes later.
function createMailer(db) {
  return {
    send({ to, subject, body }) {
      db.prepare('INSERT INTO mailbox (to_email, subject, body) VALUES (?, ?, ?)').run(to, subject, body);
    },
  };
}

module.exports = { createMailer };
