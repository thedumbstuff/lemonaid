const nodemailer = require('nodemailer');

// Sends email.
//  - With SMTP_URL set (for example smtps://user:password@smtp.example.com:465), real emails go out.
//    MAIL_FROM is the sender, for example "Lemonaid <hello@yourdomain.com>".
//  - Without it, in try-out mode, emails go to the "test mailbox" (a page at /mailbox).
//  - Without it, in production, sending fails with a clear message instead of pretending.
//
// options.smtpUrl, options.mailFrom, options.tryOutMode and options.transport (for the checks)
// take the place of the settings above.
function createMailer(db, options = {}) {
  const smtpUrl = options.smtpUrl ?? process.env.SMTP_URL ?? '';
  const from = options.mailFrom ?? process.env.MAIL_FROM ?? 'Lemonaid <no-reply@localhost>';
  const transport = options.transport || (smtpUrl ? nodemailer.createTransport(smtpUrl) : null);
  const tryOutMode = options.tryOutMode ?? process.env.NODE_ENV !== 'production';

  return {
    mode: transport ? 'smtp' : tryOutMode ? 'test-mailbox' : 'off',

    async send({ to, subject, body }) {
      if (transport) {
        await transport.sendMail({ from, to, subject, text: body });
        return;
      }
      if (tryOutMode) {
        db.prepare('INSERT INTO mailbox (to_email, subject, body) VALUES (?, ?, ?)').run(to, subject, body);
        return;
      }
      throw new Error('Email is not set up. Set SMTP_URL (see the setup guide).');
    },
  };
}

module.exports = { createMailer };
