const path = require('node:path');
const express = require('express');

function createApp() {
  const app = express();
  const pub = path.join(__dirname, '..', 'public');

  // The demo website (what an owner's own site would look like).
  app.use('/', express.static(path.join(pub, 'demo')));
  // The board itself, shown inside a frame on the owner's site.
  app.use('/board', express.static(path.join(pub, 'board')));
  // The one line an owner adds to their site: /lemonaid.js
  app.get('/lemonaid.js', (req, res) => {
    res.type('application/javascript').sendFile(path.join(pub, 'lemonaid.js'));
  });
  return app;
}

module.exports = { createApp };
