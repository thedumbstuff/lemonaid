(function () {
  var app = document.getElementById('app');

  // ---- Colour and size inside the owner's page ------------------------------------
  // The main colour comes from the embed line (?color=...) or the owner's ACCENT_COLOR.
  function setAccent(hex) {
    if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex || '')) return;
    if (hex.length === 3) hex = hex.replace(/./g, function (c) { return c + c; });
    var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    // Dark text on light colours, white text on dark ones, so buttons stay readable.
    var light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
    var root = document.documentElement.style;
    root.setProperty('--accent', '#' + hex.toLowerCase());
    root.setProperty('--on-accent', light ? '#1f2328' : '#ffffff');
  }
  var fromLink = /[?&]color=([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:&|$)/.exec(location.search);
  if (fromLink) setAccent(fromLink[1]);
  else fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) { if (c.accent) setAccent(c.accent); }).catch(function () {});

  // Tell the page around us how tall we are (see public/lemonaid.js).
  if (window.parent !== window && window.ResizeObserver) {
    var lastHeight = 0;
    new ResizeObserver(function () {
      var h = document.documentElement.scrollHeight;
      if (h !== lastHeight) { lastHeight = h; window.parent.postMessage({ lemonaid: 'height', height: h }, '*'); }
    }).observe(document.body);
  }


  // Builds an element. Text is always set as text (never as HTML), so posts can't inject code.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function when(s) {
    var d = new Date(s.replace(' ', 'T') + 'Z');
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function pill(text) { return el('span', { class: 'pill ' + text, text: text }); }
  function show(nodes) { app.replaceChildren.apply(app, nodes); }
  function getJson(url) {
    var token = getToken();
    return fetch(url, token ? { headers: { Authorization: 'Bearer ' + token } } : undefined).then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.json();
    });
  }

  // Post text arrives from our server already turned into safe HTML (see src/markdown.js).
  function rich(cls, htmlText) {
    var node = el('div', { class: cls });
    node.innerHTML = htmlText;
    return node;
  }

  function newTopicButton() {
    var b = el('button', { class: 'primary', type: 'button', text: 'New topic' });
    b.onclick = function () { location.hash = me ? '#/new' : '#/signin'; };
    return el('div', { class: 'toolbar' }, [b]);
  }

  // What the board is showing: kept while you move between topics.
  var view = { sort: 'top', label: '', status: '' };

  function voteButton(t) {
    var b = el('button', { class: 'vote' + (t.voted ? ' voted' : ''), type: 'button', 'aria-label': 'Upvote', 'aria-pressed': String(!!t.voted) }, [
      el('span', { class: 'arrow', text: '▲' }), el('span', { text: String(t.vote_count) })
    ]);
    b.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!me) { location.hash = '#/signin'; return; }
      post('/api/topics/' + t.id + '/vote').then(function (d) {
        t.voted = d.voted; t.vote_count = d.vote_count;
        b.className = 'vote' + (t.voted ? ' voted' : '');
        b.setAttribute('aria-pressed', String(t.voted));
        b.lastChild.textContent = String(t.vote_count);
      }).catch(function () {});
    };
    return b;
  }

  function picker(label, key, options) {
    var sel = el('select', { 'aria-label': label }, options.map(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if (view[key] === o[0]) opt.selected = true;
      return opt;
    }));
    sel.onchange = function () { view[key] = sel.value; renderList(); };
    return sel;
  }

  function filterBar() {
    return el('div', { class: 'filters' }, [
      picker('Sort', 'sort', [['top', 'Most wanted'], ['new', 'Newest']]),
      picker('Label', 'label', [['', 'All labels'], ['bug', 'Bugs'], ['idea', 'Ideas'], ['question', 'Questions']]),
      picker('Status', 'status', [['', 'Any status'], ['open', 'Open'], ['planned', 'Planned'], ['fixed', 'Fixed']])
    ]);
  }

  function renderList() {
    var q = '?sort=' + view.sort + (view.label ? '&label=' + view.label : '') + (view.status ? '&status=' + view.status : '');
    getJson('/api/topics' + q).then(function (data) {
      var top = el('div', { class: 'toolbar bar' }, [filterBar(), newTopicButton().firstChild]);
      if (!data.topics.length) {
        var filtered = view.label || view.status;
        return show([top, el('div', { class: 'empty', text: filtered ? 'No topics match. Try other filters.' : 'No topics yet. Be the first to start one.' })]);
      }
      show([top].concat(data.topics.map(function (t) {
        return el('div', { class: 'topic-row' }, [
          voteButton(t),
          el('a', { class: 'topic-link', href: '#/topic/' + t.id }, [
            el('div', { class: 'title', text: t.title }),
            el('div', { class: 'meta' }, [
              pill(t.label), pill(t.status),
              el('span', { text: t.reply_count + (t.reply_count === 1 ? ' reply' : ' replies') }),
              el('span', { text: 'by ' + t.author + ' · ' + when(t.created_at) })
            ])
          ])
        ]);
      })));
    }).catch(function () {
      show([el('div', { class: 'empty', text: 'The board could not be loaded. Please try again.' })]);
    });
  }

  function renderTopic(id) {
    getJson('/api/topics/' + id).then(function (data) {
      var t = data.topic;
      var nodes = [
        el('a', { class: 'back', href: '#/', text: '← All topics' }),
        el('div', { class: 'head' }, [voteButton(t), el('h2', { text: t.title })]),
        el('div', { class: 'meta' }, [pill(t.label), pill(t.status), el('span', { text: 'by ' + t.author + ' · ' + when(t.created_at) })]),
        rich('post md', t.body_html)
      ];
      if (me && me.is_owner) nodes.splice(3, 0, ownerBar(t, id));
      if (data.replies.length) {
        nodes.push(el('h3', { text: data.replies.length + (data.replies.length === 1 ? ' reply' : ' replies') }));
        data.replies.forEach(function (r) {
          var box = el('div', { class: 'post reply' }, [
            el('div', { class: 'meta', text: r.author + ' · ' + when(r.created_at) }),
            rich('md', r.body_html)
          ]);
          if (me && me.is_owner) box.appendChild(ownerActions([
            ['Delete reply', function () { return adminPost('/api/admin/reply/' + r.id + '/state', { state: 'deleted' }).then(function () { renderTopic(id); }); }],
            ['Flag ' + r.author, function () { return adminPost('/api/admin/users/' + r.author_id, { flagged: true }); }, 'Flagged: their next posts are held for you.']
          ]));
          nodes.push(box);
        });
      }
      nodes.push(replyBox(id));
      show(nodes);
    }).catch(function () {
      show([el('a', { class: 'back', href: '#/', text: '← All topics' }), el('div', { class: 'empty', text: 'That topic could not be found.' })]);
    });
  }

  // ---- The owner's tools --------------------------------------------------------
  function adminPost(url, body) { return post(url, body); }

  // A row of small buttons. Each is [label, action, messageAfter?].
  function ownerActions(items) {
    var note = el('span', { class: 'owner-note', role: 'status' });
    var row = el('div', { class: 'owner-actions' }, items.map(function (it) {
      var b = el('button', { type: 'button', class: 'small', text: it[0] });
      b.onclick = function () {
        b.disabled = true;
        it[1]().then(function () { note.textContent = it[2] || 'Done.'; b.disabled = false; })
          .catch(function (err) { note.textContent = err.message; b.disabled = false; });
      };
      return b;
    }));
    row.appendChild(note);
    return row;
  }

  function ownerBar(t, id) {
    var sel = el('select', { 'aria-label': 'Status' }, ['open', 'planned', 'fixed'].map(function (v) {
      var o = el('option', { value: v, text: v.charAt(0).toUpperCase() + v.slice(1) });
      if (t.status === v) o.selected = true;
      return o;
    }));
    sel.onchange = function () {
      adminPost('/api/admin/topic/' + id + '/status', { status: sel.value }).then(function () { renderTopic(id); });
    };
    var bar = el('div', { class: 'owner-bar' }, [el('span', { text: 'Owner:' }), sel]);
    bar.appendChild(ownerActions([
      ['Delete topic', function () { return adminPost('/api/admin/topic/' + id + '/state', { state: 'deleted' }).then(function () { location.hash = '#/'; }); }],
      ['Flag ' + t.author, function () { return adminPost('/api/admin/users/' + t.author_id, { flagged: true }); }, 'Flagged: their next posts are held for you.']
    ]));
    return bar;
  }

  // The optional AI check: a switch, shown as off (and explained) until a key is added.
  function aiBox(ai) {
    var box = el('div', { class: 'ai-box' });
    var note = el('span', { class: 'owner-note', role: 'status' });
    var title = el('b', { text: 'AI check: ' + (ai.enabled ? 'on' : 'off') });
    var text;
    if (!ai.available) text = 'Off until a key is added. To turn it on, set ANTHROPIC_API_KEY (from console.anthropic.com) where Lemonaid runs and restart it.';
    else if (ai.enabled) text = 'New posts are read by Claude (' + ai.model + ') first. Rude, hateful, threatening or spammy ones wait here for you, even without swear words.';
    else text = 'A key is set up. Switch it on and posts that look rude, hateful, threatening or spammy will wait here for you, even without swear words.';
    box.appendChild(title);
    box.appendChild(el('p', { class: 'hint', text: text }));
    if (ai.available) {
      var b = el('button', { type: 'button', class: 'small', text: ai.enabled ? 'Switch off' : 'Switch on' });
      b.onclick = function () {
        b.disabled = true;
        adminPost('/api/admin/ai', { enabled: !ai.enabled }).then(renderOwnerRoom).catch(function (err) { note.textContent = err.message; b.disabled = false; });
      };
      box.appendChild(b);
      box.appendChild(note);
    }
    return box;
  }

  function renderOwnerRoom() {
    if (!me || !me.is_owner) { location.hash = '#/'; return; }
    getJson('/api/admin/overview').then(function (data) {
      function postCard(p, buttons) {
        var where = p.kind === 'topic' ? 'Topic: ' + p.title : 'Reply';
        var card = el('div', { class: 'post' }, [
          el('div', { class: 'meta', text: where + ' · by ' + p.author + ' · ' + when(p.created_at) }),
          rich('md', p.body_html)
        ]);
        if (p.hold_reason) card.insertBefore(el('div', { class: 'hold-reason', text: 'Why it is waiting: ' + p.hold_reason }), card.firstChild.nextSibling);
        card.appendChild(ownerActions(buttons));
        return card;
      }
      function decide(p, state, label) {
        return [label, function () {
          return adminPost('/api/admin/' + p.kind + '/' + p.id + '/state', { state: state }).then(renderOwnerRoom);
        }];
      }
      var nodes = [el('a', { class: 'back', href: '#/', text: '← All topics' }), el('h2', { text: "Owner's room" })];

      nodes.push(aiBox(data.ai));
      nodes.push(el('h3', { text: 'Waiting for you (' + data.held.length + ')' }));
      nodes.push(el('p', { class: 'hint', text: 'Posts from people you flagged wait here until you let them through.' }));
      if (!data.held.length) nodes.push(el('div', { class: 'empty small', text: 'Nothing is waiting.' }));
      data.held.forEach(function (p) { nodes.push(postCard(p, [decide(p, 'visible', 'Let through'), decide(p, 'deleted', 'Delete')])); });

      nodes.push(el('h3', { text: 'Recently deleted (' + data.deleted.length + ')' }));
      if (!data.deleted.length) nodes.push(el('div', { class: 'empty small', text: 'Nothing deleted.' }));
      data.deleted.forEach(function (p) { nodes.push(postCard(p, [decide(p, 'visible', 'Bring back')])); });

      nodes.push(el('h3', { text: 'People (' + data.users.length + ')' }));
      nodes.push(el('p', { class: 'hint', text: 'Flagged: their posts wait for you. Blocked: they cannot post at all. Only you can see email addresses.' }));
      data.users.forEach(function (u) {
        var row = el('div', { class: 'person' }, [
          el('div', {}, [
            el('b', { text: u.name }), el('span', { class: 'meta', text: ' ' + u.email + ' · ' + u.posts + (u.posts === 1 ? ' post' : ' posts') }),
            u.flagged ? pill('flagged') : el('span'), u.blocked ? pill('blocked') : el('span'), u.is_owner ? pill('owner') : el('span')
          ])
        ]);
        if (!u.is_owner) {
          row.appendChild(ownerActions([
            [u.flagged ? 'Unflag' : 'Flag', function () { return adminPost('/api/admin/users/' + u.id, { flagged: !u.flagged }).then(renderOwnerRoom); }],
            [u.blocked ? 'Unblock' : 'Block', function () { return adminPost('/api/admin/users/' + u.id, { blocked: !u.blocked }).then(renderOwnerRoom); }]
          ]));
        }
        nodes.push(row);
      });
      show(nodes);
    }).catch(function () {
      show([el('div', { class: 'empty', text: "The Owner's room could not be loaded." })]);
    });
  }

  // ---- Signing in -------------------------------------------------------------
  // The board lives in a frame on other people's sites, so the sign-in token is kept in
  // the browser's storage and sent along with each request (not in a cookie).
  var memoryToken = null;
  function getToken() {
    try { return localStorage.getItem('lemonaid-token') || memoryToken; } catch (e) { return memoryToken; }
  }
  function setToken(t) {
    memoryToken = t;
    try { if (t) localStorage.setItem('lemonaid-token', t); else localStorage.removeItem('lemonaid-token'); } catch (e) {}
  }
  var me = null; // { name } when signed in

  function post(url, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (getToken()) headers.Authorization = 'Bearer ' + getToken();
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  function renderAccount() {
    var box = document.getElementById('account');
    if (me) {
      var out = el('button', { class: 'link', type: 'button', text: 'Sign out' });
      out.onclick = function () {
        post('/api/auth/logout').catch(function () {}).then(function () {
          setToken(null); me = null; renderAccount(); location.hash = '#/';
        });
      };
      var parts = [];
      if (me.is_owner) parts.push(el('a', { href: '#/owner', text: "Owner's room" }));
      parts.push(el('span', { text: 'Signed in as ' + me.name }));
      var mail = el('button', { class: 'link', type: 'button', text: me.notify ? 'Reply emails: on' : 'Reply emails: off', title: 'Get an email when someone replies to your topics' });
      mail.onclick = function () {
        post('/api/auth/notify', { enabled: !me.notify }).then(function (d) { me.notify = d.notify; renderAccount(); }).catch(function () {});
      };
      parts.push(mail, out);
      box.replaceChildren.apply(box, parts);
    } else {
      var btn = el('button', { type: 'button', text: 'Sign in' });
      btn.onclick = function () { location.hash = '#/signin'; };
      box.replaceChildren(btn);
    }
  }

  function loadMe() {
    var token = getToken();
    if (!token) { me = null; return Promise.resolve(); }
    return fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { me = d.user; })
      .catch(function () { me = null; setToken(null); });
  }

  function renderSignIn() {
    if (me) { location.hash = '#/'; return; }
    var error = el('div', { class: 'error', role: 'alert' });
    var email = el('input', { type: 'email', placeholder: 'you@example.com', required: 'required', autocomplete: 'email', 'aria-label': 'Your email' });
    var go = el('button', { class: 'primary', type: 'submit', text: 'Send me a code' });
    var form = el('form', { class: 'card' }, [
      el('h2', { text: 'Sign in' }),
      el('p', { text: 'Type your email and we will send you a 6-digit code. No password needed. Your email is never shown to others.' }),
      email, error, go
    ]);

    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = '';
      go.disabled = true;
      post('/api/auth/request-code', { email: email.value }).then(function () {
        askForCode(email.value.trim());
      }).catch(function (err) {
        error.textContent = err.message; go.disabled = false;
      });
    };
    show([form]);
    email.focus();
  }

  function askForCode(address) {
    var error = el('div', { class: 'error', role: 'alert' });
    var code = el('input', { class: 'code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', placeholder: '000000', required: 'required', 'aria-label': '6-digit code' });
    var go = el('button', { class: 'primary', type: 'submit', text: 'Sign in' });
    var again = el('button', { class: 'link', type: 'button', text: 'Use a different email' });
    again.onclick = renderSignIn;
    var form = el('form', { class: 'card' }, [
      el('h2', { text: 'Check your email' }),
      el('p', { text: 'We sent a 6-digit code to ' + address + '. It works for 10 minutes.' }),
      code, error, go, again
    ]);
    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = '';
      go.disabled = true;
      post('/api/auth/verify-code', { email: address, code: code.value }).then(function (d) {
        setToken(d.token); me = d.user; renderAccount(); location.hash = '#/';
      }).catch(function (err) {
        error.textContent = err.message; go.disabled = false;
      });
    };
    show([form]);
    code.focus();
  }

  // ---- Writing ----------------------------------------------------------------
  var HELD_NOTE = 'Thanks! Your post is waiting for the owner to look at it before it shows on the board.';
  var HELP = 'You can use **bold**, `code`, links, and ``` on its own line for a block of code. Paste a screenshot to add it.';

  // A text box with a Preview button underneath. Returns { box, input }.
  function editor(placeholder, rows) {
    var input = el('textarea', { rows: String(rows), placeholder: placeholder, required: 'required', maxlength: '10000', 'aria-label': 'Your text' });
    var preview = el('div', { class: 'md preview', hidden: 'hidden' });
    var toggle = el('button', { class: 'link', type: 'button', text: 'Preview' });
    var showing = false;
    toggle.onclick = function () {
      showing = !showing;
      if (!showing) { preview.hidden = true; input.hidden = false; toggle.textContent = 'Preview'; return; }
      post('/api/preview', { body: input.value }).then(function (d) {
        preview.innerHTML = d.html || '<p><em>Nothing to preview yet.</em></p>';
        preview.hidden = false; input.hidden = true; toggle.textContent = 'Back to editing';
      }).catch(function () { showing = false; });
    };
    var status = el('span', { class: 'upload-status', role: 'status' });

    // Pasting a picture (like a screenshot) saves it and puts it into the text.
    input.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
          var file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          uploadPicture(file);
          return;
        }
      }
    });
    function uploadPicture(file) {
      status.textContent = 'Adding your picture…';
      status.className = 'upload-status';
      fetch('/api/images', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'The picture could not be added.');
          return d;
        });
      }).then(function (d) {
        var text = '![screenshot](' + d.url + ')';
        var start = input.selectionStart, end = input.selectionEnd;
        input.value = input.value.slice(0, start) + text + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + text.length;
        status.textContent = 'Picture added.';
      }).catch(function (err) {
        status.textContent = err.message;
        status.className = 'upload-status error';
      });
    }

    var box = el('div', { class: 'editor' }, [input, preview, el('div', { class: 'help' }, [toggle, el('span', { text: HELP }), status])]);
    return { box: box, input: input };
  }

  function replyBox(topicId) {
    if (!me) {
      var b = el('button', { type: 'button', text: 'Sign in to reply' });
      b.onclick = function () { location.hash = '#/signin'; };
      return el('div', { class: 'toolbar' }, [b]);
    }
    var ed = editor('Write a reply…', 4);
    var error = el('div', { class: 'error', role: 'alert' });
    var go = el('button', { class: 'primary', type: 'submit', text: 'Reply' });
    var form = el('form', { class: 'write' }, [el('h3', { text: 'Your reply' }), ed.box, error, go]);
    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = ''; go.disabled = true;
      post('/api/topics/' + topicId + '/replies', { body: ed.input.value }).then(function (d) {
        if (d.held) return show([el('a', { class: 'back', href: '#/', text: '← All topics' }), el('div', { class: 'empty', text: HELD_NOTE })]);
        renderTopic(topicId);
      }).catch(function (err) { error.textContent = err.message; go.disabled = false; });
    };
    return form;
  }

  function renderNew() {
    if (!me) { location.hash = '#/signin'; return; }
    var error = el('div', { class: 'error', role: 'alert' });
    var title = el('input', { type: 'text', placeholder: 'A short title', required: 'required', maxlength: '120', 'aria-label': 'Title' });
    var label = el('select', { 'aria-label': 'Label' }, [
      el('option', { value: 'question', text: 'Question' }),
      el('option', { value: 'idea', text: 'Idea' }),
      el('option', { value: 'bug', text: 'Bug' })
    ]);
    var ed = editor('Tell us more. Paste links or code if it helps.', 8);
    var go = el('button', { class: 'primary', type: 'submit', text: 'Post topic' });
    var form = el('form', { class: 'write' }, [
      el('a', { class: 'back', href: '#/', text: '← All topics' }),
      el('h2', { text: 'New topic' }),
      el('div', { class: 'row' }, [title, label]), ed.box, error, go
    ]);
    form.onsubmit = function (e) {
      e.preventDefault();
      error.textContent = ''; go.disabled = true;
      post('/api/topics', { title: title.value, label: label.value, body: ed.input.value }).then(function (d) {
        if (d.held) return show([el('a', { class: 'back', href: '#/', text: '← All topics' }), el('div', { class: 'empty', text: HELD_NOTE })]);
        location.hash = '#/topic/' + d.id;
      }).catch(function (err) { error.textContent = err.message; go.disabled = false; });
    };
    show([form]);
    title.focus();
  }

  function route() {
    var m = location.hash.match(/^#\/topic\/(\d+)$/);
    if (m) renderTopic(m[1]);
    else if (location.hash === '#/new') renderNew();
    else if (location.hash === '#/owner') renderOwnerRoom();
    else if (location.hash === '#/signin') renderSignIn();
    else renderList();
  }
  window.addEventListener('hashchange', route);
  loadMe().then(function () { renderAccount(); route(); });
})();
