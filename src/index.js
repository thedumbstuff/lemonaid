const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Lemonaid is running: http://localhost:${port}`);
});
if (process.env.NODE_ENV !== 'production') {
  console.log(
    'Try-out mode: the test mailbox is open to everyone (/mailbox) and the owner is owner@lemonaid.local.\n' +
      'Before putting Lemonaid online, set NODE_ENV=production and OWNER_EMAIL=you@yourdomain.'
  );
}
