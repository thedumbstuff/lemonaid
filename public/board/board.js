(function () {
  // The board looks like a chat app: topics on the left (like chats), and the open topic on
  // the right, with the topic pinned at the top and the discussion below it. On a phone,
  // one side shows at a time.
  var shell = document.getElementById('shell');
  var app = document.getElementById('app');
  var listBox = document.getElementById('list');
  var toolsBox = document.getElementById('tools');

  // ---- Colour and frame ---------------------------------------------------------------
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
  if (window.parent !== window) document.documentElement.classList.add('embedded');

  // ---- Small helpers ------------------------------------------------------------------
  // Builds an element. Text is always set as text (never as HTML), so posts can't inject code.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  // Post text arrives from our server already turned into safe HTML (see src/markdown.js).
  function rich(cls, htmlText) {
    var node = el('div', { class: cls });
    node.innerHTML = htmlText;
    return node;
  }
  function show(nodes) { app.replaceChildren.apply(app, nodes); }
  function pill(text) { return el('span', { class: 'pill ' + text, text: text }); }
  var ICONS = { bug: '🐞', idea: '💡', question: '❓' };
  function avatar(label) { return el('span', { class: 'avatar ' + label, 'aria-hidden': 'true', text: ICONS[label] || '💬' }); }
  // Each person's name gets one of a few colours, like names in a group chat.
  function colourOf(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
    return 'c' + (h % 6);
  }

  // ---- Times --------------------------------------------------------------------------
  function parseTime(s) { return new Date(String(s).replace(' ', 'T') + 'Z'); }
  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
  function daysAgo(d) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(d); day.setHours(0, 0, 0, 0);
    return Math.round((today - day) / 86400000);
  }
  function clock(d) { return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function when(s) {
    var d = parseTime(s);
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  // Time in the topic list: 14:05, Yesterday, Mon, or 3 Oct.
  function listTime(s) {
    var d = parseTime(s);
    if (isNaN(d)) return '';
    var n = daysAgo(d);
    if (n <= 0) return clock(d);
    if (n === 1) return 'Yesterday';
    if (n < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  // The little date bubble between messages of different days.
  function dayLabel(d) {
    var n = daysAgo(d);
    if (n <= 0) return 'Today';
    if (n === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---- Talking to the server ----------------------------------------------------------
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
  var me = null; // { name, is_owner, notify } when signed in

  function getJson(url) {
    var token = getToken();
    return fetch(url, token ? { headers: { Authorization: 'Bearer ' + token } } : undefined).then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.json();
    });
  }
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
  var adminPost = post;

  // Which replies you have already seen, per topic, to show unread counts (this browser only).
  function seenAll() {
    try { return JSON.parse(localStorage.getItem('lemonaid-seen') || '{}') || {}; } catch (e) { return {}; }
  }
  function markSeen(id, count) {
    var all = seenAll();
    all[id] = count;
    try { localStorage.setItem('lemonaid-seen', JSON.stringify(all)); } catch (e) {}
  }

  // ---- Signing in: where to come back to afterwards ------------------------------------
  var afterSignIn = '#/';
  function goSignIn() {
    afterSignIn = /^#\/topic\/\d+$/.test(location.hash) || location.hash === '#/new' ? location.hash : '#/';
    location.hash = '#/signin';
  }

  // ---- Upvotes ------------------------------------------------------------------------
  function voteButton(t, onChange) {
    var b = el('button', { class: 'vote' + (t.voted ? ' voted' : ''), type: 'button', 'aria-label': 'Upvote', 'aria-pressed': String(!!t.voted), title: 'Upvote: the most wanted rise to the top' }, [
      el('span', { class: 'arrow', text: '▲' }), el('span', { text: String(t.vote_count) })
    ]);
    b.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!me) { goSignIn(); return; }
      post('/api/topics/' + t.id + '/vote').then(function (d) {
        t.voted = d.voted; t.vote_count = d.vote_count;
        b.className = 'vote' + (t.voted ? ' voted' : '');
        b.setAttribute('aria-pressed', String(t.voted));
        b.lastChild.textContent = String(t.vote_count);
        if (onChange) onChange();
      }).catch(function () {});
    };
    return b;
  }

  // ---- The topic list (left side) ------------------------------------------------------
  // What the list is showing: kept while you move between topics.
  var view = { sort: 'active', label: '', status: '', search: '' };
  var topics = null; // the last list from the server

  function drawTools() {
    var search = el('input', { class: 'search', type: 'search', placeholder: 'Search topics', 'aria-label': 'Search topics' });
    search.value = view.search;
    search.oninput = function () { view.search = search.value; drawList(); };
    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Label' }, [['', 'All'], ['bug', 'Bugs'], ['idea', 'Ideas'], ['question', 'Questions']].map(function (o) {
      var c = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(view.label === o[0]), text: o[1] });
      c.onclick = function () { view.label = o[0]; drawTools(); loadList(); };
      return c;
    }));
    function picker(label, key, options) {
      var sel = el('select', { 'aria-label': label }, options.map(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (view[key] === o[0]) opt.selected = true;
        return opt;
      }));
      sel.onchange = function () { view[key] = sel.value; loadList(); };
      return sel;
    }
    var selects = el('div', { class: 'selects' }, [
      picker('Sort', 'sort', [['active', 'Latest activity'], ['top', 'Most wanted'], ['new', 'Newest topics']]),
      picker('Status', 'status', [['', 'Any status'], ['open', 'Open'], ['planned', 'Planned'], ['fixed', 'Fixed']])
    ]);
    toolsBox.replaceChildren(search, chips, selects);
  }

  function loadList() {
    var q = '?sort=' + view.sort + (view.label ? '&label=' + view.label : '') + (view.status ? '&status=' + view.status : '');
    return getJson('/api/topics' + q).then(function (data) {
      topics = data.topics;
      drawList();
    }).catch(function () {
      if (!topics) listBox.replaceChildren(el('div', { class: 'empty', text: 'The board could not be loaded. Please try again.' }));
    });
  }

  function openTopicId() {
    var m = location.hash.match(/^#\/topic\/(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  function drawList() {
    if (!topics) return;
    var words = view.search.trim().toLowerCase();
    var shown = topics.filter(function (t) {
      return !words || (t.title + ' ' + t.last.text).toLowerCase().indexOf(words) !== -1;
    });
    if (!shown.length) {
      var text = words ? 'No topics match your search.' : (view.label || view.status) ? 'No topics match. Try other filters.' : 'No topics yet. Be the first to start one.';
      listBox.replaceChildren(el('div', { class: 'empty', text: text }));
      return;
    }
    var seen = seenAll();
    var open = openTopicId();
    listBox.replaceChildren.apply(listBox, shown.map(function (t) {
      var unread = seen[t.id] !== undefined && t.reply_count > seen[t.id] ? t.reply_count - seen[t.id] : 0;
      var who = t.last.author === (me && me.name) ? 'You' : t.last.author;
      var label = t.title + ', ' + t.label + ', ' + t.status + ', ' + t.vote_count + ' upvotes, ' + t.reply_count + (t.reply_count === 1 ? ' reply' : ' replies') + (unread ? ', ' + unread + ' new' : '');
      return el('a', { class: 'chat' + (t.id === open ? ' active' : '') + (unread ? ' unread' : ''), href: '#/topic/' + t.id, 'aria-label': label, 'aria-current': t.id === open ? 'page' : 'false' }, [
        avatar(t.label),
        el('div', { class: 'chat-text' }, [
          el('div', { class: 'chat-line' }, [
            el('span', { class: 'chat-title', text: t.title }),
            el('span', { class: 'chat-time', text: listTime(t.last.at) })
          ]),
          el('div', { class: 'chat-line' }, [
            el('span', { class: 'chat-last', text: who + ': ' + t.last.text }),
            el('span', { class: 'chat-badges' }, [
              t.status !== 'open' ? pill(t.status) : null,
              el('span', { class: 'votes', text: '▲ ' + t.vote_count }),
              unread ? el('span', { class: 'badge', text: String(unread) }) : null
            ])
          ])
        ])
      ]);
    }));
  }

  // ---- The right side's top bar ----------------------------------------------------------
  function paneHead(title, extra) {
    return el('div', { class: 'pane-head' }, [
      el('a', { class: 'back', href: '#/', 'aria-label': 'Back to all topics', text: '←' }),
      el('div', { class: 'head-text' }, [el('h2', { text: title })])
    ].concat(extra || []));
  }
  function paneBody(children) { return el('div', { class: 'pane-body' }, children); }

  function renderWelcome() {
    show([el('div', { class: 'welcome' }, [
      el('div', {}, [
        el('div', { class: 'big', text: '🍋' }),
        el('h2', { text: 'Pick a topic to join the discussion' }),
        el('p', { text: 'Ask a question, share an idea or report a bug. Anyone can read; sign in with your email to write.' })
      ])
    ])]);
  }

  // ---- A topic, as a chat ---------------------------------------------------------------
  var chat = null; // the open chat: { id, messages, sig }

  function chatHead(t) {
    return el('div', { class: 'pane-head' }, [
      el('a', { class: 'back', href: '#/', 'aria-label': 'Back to all topics', text: '←' }),
      avatar(t.label),
      el('div', { class: 'head-text' }, [
        el('h2', { text: t.title }),
        el('div', { class: 'sub' }, [pill(t.label), pill(t.status), el('span', { text: 'started by ' + t.author })])
      ]),
      voteButton(t, loadList)
    ]);
  }

  // The topic itself, pinned at the top. Long topics are folded, with a button to unfold.
  function pinned(t, id) {
    var body = rich('md', t.body_html);
    var more = el('button', { class: 'link more', type: 'button', text: 'Show all', hidden: 'hidden' });
    var box = el('section', { class: 'pinned', 'aria-label': 'The topic' }, [
      el('div', { class: 'pinned-meta' }, [
        el('span', { class: 'pin', 'aria-hidden': 'true', text: '📌' }),
        el('b', { class: 'name ' + colourOf(t.author), text: t.mine ? 'You' : t.author }),
        t.by_owner ? el('span', { class: 'tag', text: 'owner' }) : null,
        el('span', { text: ' · ' + when(t.created_at) })
      ]),
      body, more
    ]);
    function fits() {
      if (box.classList.contains('open')) return;
      more.hidden = body.scrollHeight <= body.clientHeight + 2;
    }
    more.onclick = function () {
      var open = box.classList.toggle('open');
      more.textContent = open ? 'Show less' : 'Show all';
    };
    Array.prototype.forEach.call(body.querySelectorAll('img'), function (img) { img.addEventListener('load', fits); });
    setTimeout(fits, 0);
    if (me && me.is_owner) box.appendChild(ownerBar(t, id));
    return box;
  }

  function drawMessages(box, replies) {
    var nodes = [];
    if (!replies.length) nodes.push(el('div', { class: 'system', text: 'No replies yet. Start the discussion below.' }));
    var lastDay = null, lastAuthor = null;
    replies.forEach(function (r) {
      var d = parseTime(r.created_at);
      if (!lastDay || !sameDay(lastDay, d)) {
        nodes.push(el('div', { class: 'day' }, [el('span', { text: dayLabel(d) })]));
        lastAuthor = null;
      }
      var follows = lastAuthor === r.author;
      lastDay = d; lastAuthor = r.author;
      var bubble = el('div', { class: 'msg' + (r.mine ? ' mine' : '') + (follows ? ' cont' : '') }, [
        r.mine || follows ? null : el('div', { class: 'name ' + colourOf(r.author) }, [
          el('span', { text: r.author }), r.by_owner ? el('span', { class: 'tag', text: 'owner' }) : null
        ]),
        rich('md', r.body_html),
        el('div', { class: 'time', text: clock(d) })
      ]);
      if (me && me.is_owner) bubble.appendChild(ownerActions([
        ['Delete', function () { return adminPost('/api/admin/reply/' + r.id + '/state', { state: 'deleted' }).then(function () { refreshChat(true); }); }],
        r.mine ? null : ['Flag ' + r.author, function () { return adminPost('/api/admin/users/' + r.author_id, { flagged: true }); }, 'Flagged: their next posts are held for you.']
      ]));
      nodes.push(bubble);
    });
    box.replaceChildren.apply(box, nodes);
  }

  function nearBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }
  function toBottom(box) {
    box.scrollTop = box.scrollHeight;
    // Pictures load a moment later and push things down: keep the newest message in view.
    Array.prototype.forEach.call(box.querySelectorAll('img'), function (img) {
      if (!img.complete) img.addEventListener('load', function () { box.scrollTop = box.scrollHeight; });
    });
  }
  function signature(data) {
    return data.replies.map(function (r) { return r.id; }).join(',');
  }

  function renderTopic(id) {
    getJson('/api/topics/' + id).then(function (data) {
      if (openTopicId() !== Number(id)) return; // they moved on while it loaded
      var t = data.topic;
      var messages = el('div', { class: 'messages', role: 'log', 'aria-label': 'Discussion' });
      drawMessages(messages, data.replies);
      chat = { id: Number(id), messages: messages, sig: signature(data) };
      markSeen(id, data.replies.length);
      drawList();
      show([chatHead(t), pinned(t, id), messages, composer(id)]);
      toBottom(messages);
    }).catch(function () {
      show([paneHead('Not found'), paneBody([el('div', { class: 'empty', text: 'That topic could not be found. It may have been removed.' })])]);
    });
  }

  // Fetches the open topic again and shows new messages, without touching what you are typing.
  function refreshChat(force) {
    if (!chat) return Promise.resolve();
    var current = chat;
    return getJson('/api/topics/' + current.id).then(function (data) {
      if (chat !== current) return;
      var sig = signature(data);
      if (!force && sig === current.sig) return;
      var stay = nearBottom(current.messages);
      current.sig = sig;
      drawMessages(current.messages, data.replies);
      markSeen(current.id, data.replies.length);
      if (stay || force) toBottom(current.messages);
    }).catch(function () {});
  }

  // A note in the middle of the chat, like "Your message is waiting for the owner".
  function systemNote(text) {
    if (!chat) return;
    chat.messages.appendChild(el('div', { class: 'system', role: 'status', text: text }));
    toBottom(chat.messages);
  }

  // ---- Pictures --------------------------------------------------------------------------
  // Saves a picture and puts it into the text box where the cursor is.
  function addPicture(file, input, status) {
    status.textContent = 'Adding your picture…';
    status.classList.remove('error');
    return fetch('/api/images', {
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
      input.dispatchEvent(new Event('input'));
      status.textContent = 'Picture added.';
    }).catch(function (err) {
      status.textContent = err.message;
      status.classList.add('error');
    });
  }
  // Pasting a picture (like a screenshot) into a text box adds it.
  function pastePictures(input, status) {
    input.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
          var file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          addPicture(file, input, status);
          return;
        }
      }
    });
  }

  // ---- Writing a reply: the bar at the bottom of the chat ---------------------------------
  var HELD_NOTE = 'Thanks! Your post is waiting for the owner to look at it before it shows on the board.';
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function composer(topicId) {
    if (!me) {
      var b = el('button', { class: 'primary', type: 'button', text: 'Sign in to reply' });
      b.onclick = goSignIn;
      return el('div', { class: 'composer signed-out' }, [b]);
    }
    var input = el('textarea', { rows: '1', placeholder: 'Write a reply', maxlength: '10000', 'aria-label': 'Your reply' });
    var note = el('div', { class: 'composer-note', role: 'status' });
    var file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: 'hidden' });
    var attach = el('button', { class: 'icon', type: 'button', 'aria-label': 'Add a picture', title: 'Add a picture', text: '📎' });
    var send = el('button', { class: 'primary send', type: 'submit', 'aria-label': 'Send', title: 'Send', text: '➤' });
    var help = el('div', { class: 'composer-help', text: (touch ? '' : 'Enter sends, Shift+Enter starts a new line. ') + 'Use **bold**, `code`, ``` for a block of code, or paste a screenshot.' });
    var form = el('form', { class: 'composer' }, [note, el('div', { class: 'composer-row' }, [attach, input, send]), help, file]);

    function grow() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight + 2, 160) + 'px';
    }
    input.addEventListener('input', grow);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !touch && !e.isComposing) { e.preventDefault(); submit(); }
    });
    pastePictures(input, note);
    attach.onclick = function () { file.click(); };
    file.onchange = function () {
      if (file.files[0]) addPicture(file.files[0], input, note).then(function () { input.focus(); });
      file.value = '';
    };

    var busy = false;
    function submit() {
      if (busy) return;
      if (!input.value.trim()) { input.focus(); return; }
      busy = true; send.disabled = true;
      note.textContent = ''; note.classList.remove('error');
      post('/api/topics/' + topicId + '/replies', { body: input.value }).then(function (d) {
        input.value = ''; grow();
        if (d.held) systemNote(HELD_NOTE);
        else refreshChat(true);
        loadList();
      }).catch(function (err) {
        note.textContent = err.message; note.classList.add('error');
      }).then(function () { busy = false; send.disabled = false; input.focus(); });
    }
    form.onsubmit = function (e) { e.preventDefault(); submit(); };
    return form;
  }

  // ---- The owner's tools --------------------------------------------------------------
  // A row of small buttons. Each is [label, action, messageAfter?].
  function ownerActions(items) {
    var note = el('span', { class: 'owner-note', role: 'status' });
    var row = el('div', { class: 'owner-actions' }, items.filter(Boolean).map(function (it) {
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
      adminPost('/api/admin/topic/' + id + '/status', { status: sel.value }).then(function () { loadList(); renderTopic(id); });
    };
    var bar = el('div', { class: 'owner-bar' }, [el('span', { text: 'Owner:' }), sel]);
    bar.appendChild(ownerActions([
      ['Delete topic', function () { return adminPost('/api/admin/topic/' + id + '/state', { state: 'deleted' }).then(function () { loadList(); location.hash = '#/'; }); }],
      t.mine ? null : ['Flag ' + t.author, function () { return adminPost('/api/admin/users/' + t.author_id, { flagged: true }); }, 'Flagged: their next posts are held for you.']
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
          return adminPost('/api/admin/' + p.kind + '/' + p.id + '/state', { state: state }).then(function () { loadList(); renderOwnerRoom(); });
        }];
      }
      var nodes = [aiBox(data.ai)];
      nodes.push(el('h3', { text: 'Waiting for you (' + data.held.length + ')' }));
      nodes.push(el('p', { class: 'hint', text: 'Posts from people you flagged, or held by the AI check, wait here until you let them through.' }));
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
            u.flagged ? pill('flagged') : null, u.blocked ? pill('blocked') : null, u.is_owner ? pill('owner') : null
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
      show([paneHead("Owner's room"), paneBody(nodes)]);
    }).catch(function () {
      show([paneHead("Owner's room"), paneBody([el('div', { class: 'empty', text: "The Owner's room could not be loaded." })])]);
    });
  }

  // ---- Your account (top of the list) ---------------------------------------------------
  function renderAccount() {
    var box = document.getElementById('account');
    var add = el('button', { class: 'primary new', type: 'button', title: 'Start a new topic', text: '+ New' });
    add.onclick = function () { if (me) location.hash = '#/new'; else { afterSignIn = '#/new'; location.hash = '#/signin'; } };
    if (!me) {
      var btn = el('button', { type: 'button', text: 'Sign in' });
      btn.onclick = goSignIn;
      box.replaceChildren(add, btn);
      return;
    }
    var menu = el('details', { class: 'menu' });
    function item(node, action) {
      node.onclick = function () { menu.open = false; if (action) action(); };
      return node;
    }
    var mail = item(el('button', { type: 'button', text: me.notify ? 'Reply emails: on' : 'Reply emails: off', title: 'Get an email when someone replies to your topics' }), function () {
      post('/api/auth/notify', { enabled: !me.notify }).then(function (d) { me.notify = d.notify; renderAccount(); }).catch(function () {});
    });
    var out = item(el('button', { type: 'button', text: 'Sign out' }), function () {
      post('/api/auth/logout').catch(function () {}).then(function () {
        setToken(null); me = null; renderAccount(); loadList();
        if (location.hash === '#/') route(); else location.hash = '#/';
      });
    });
    menu.appendChild(el('summary', { class: 'me', 'aria-label': 'Your account', title: 'Signed in as ' + me.name, text: me.name.charAt(0).toUpperCase() }));
    menu.appendChild(el('div', { class: 'menu-list' }, [
      el('div', { class: 'menu-who', text: 'Signed in as ' + me.name }),
      me.is_owner ? item(el('a', { href: '#/owner', text: "Owner's room" })) : null,
      mail, out
    ]));
    box.replaceChildren(add, menu);
  }
  // Clicking anywhere else closes the account menu.
  document.addEventListener('click', function (e) {
    var menu = document.querySelector('.menu[open]');
    if (menu && !menu.contains(e.target)) menu.open = false;
  });

  function loadMe() {
    var token = getToken();
    if (!token) { me = null; return Promise.resolve(); }
    return fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { me = d.user; })
      .catch(function () { me = null; setToken(null); });
  }

  // ---- Signing in -----------------------------------------------------------------------
  // Shows a button as busy: it can't be pressed again and says what is happening.
  function busyButton(b, busyText) {
    var normal = b.textContent;
    return function (on) { b.disabled = on; b.textContent = on ? busyText : normal; b.setAttribute('aria-busy', String(on)); };
  }

  function renderSignIn() {
    if (me) { location.hash = '#/'; return; }
    var error = el('div', { class: 'error', role: 'alert' });
    var email = el('input', { type: 'email', placeholder: 'you@example.com', required: 'required', autocomplete: 'email', 'aria-label': 'Your email' });
    var go = el('button', { class: 'primary', type: 'submit', text: 'Send me a code' });
    var setBusy = busyButton(go, 'Sending the code…');
    var form = el('form', { class: 'card' }, [
      el('h2', { text: 'Sign in' }),
      el('p', { text: 'Type your email and we will send you a 6-digit code. No password needed. Your email is never shown to others.' }),
      email, error, go
    ]);
    var busy = false;
    form.onsubmit = function (e) {
      e.preventDefault();
      if (busy) return; // one press sends one code
      busy = true; setBusy(true); email.readOnly = true;
      error.textContent = '';
      post('/api/auth/request-code', { email: email.value }).then(function () {
        askForCode(email.value.trim());
      }).catch(function (err) {
        error.textContent = err.message;
        busy = false; setBusy(false); email.readOnly = false;
      });
    };
    show([paneHead('Sign in'), paneBody([form])]);
    email.focus();
  }

  var RESEND_AFTER = 30; // seconds before a new code can be asked for

  function askForCode(address) {
    var error = el('div', { class: 'error', role: 'alert' });
    var info = el('p', { role: 'status', text: 'We sent a 6-digit code to ' + address + '. It works for 10 minutes.' });
    var code = el('input', { class: 'code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', placeholder: '000000', required: 'required', 'aria-label': '6-digit code' });
    var go = el('button', { class: 'primary', type: 'submit', text: 'Sign in' });
    var setBusy = busyButton(go, 'Checking…');
    var resend = el('button', { class: 'link', type: 'button' });
    var other = el('button', { class: 'link', type: 'button', text: 'Use a different email' });
    other.onclick = renderSignIn;
    var form = el('form', { class: 'card' }, [
      el('h2', { text: 'Check your email' }), info, code, error, go,
      el('div', { class: 'card-links' }, [resend, other])
    ]);

    // "Send a new code" waits a little, so one press can't send a pile of codes.
    var timer = null;
    function countDown(seconds) {
      clearInterval(timer);
      resend.disabled = true;
      resend.textContent = 'Send a new code in ' + seconds + 's';
      timer = setInterval(function () {
        seconds -= 1;
        if (!document.body.contains(resend)) { clearInterval(timer); return; }
        if (seconds <= 0) { clearInterval(timer); resend.disabled = false; resend.textContent = 'Send a new code'; return; }
        resend.textContent = 'Send a new code in ' + seconds + 's';
      }, 1000);
    }
    countDown(RESEND_AFTER);
    resend.onclick = function () {
      resend.disabled = true; resend.textContent = 'Sending…'; error.textContent = '';
      post('/api/auth/request-code', { email: address }).then(function () {
        info.textContent = 'We sent a new code to ' + address + '. Only the newest code works.';
        countDown(RESEND_AFTER);
      }).catch(function (err) {
        error.textContent = err.message;
        resend.disabled = false; resend.textContent = 'Send a new code';
      });
    };

    var busy = false;
    function check() {
      if (busy) return;
      busy = true; setBusy(true); error.textContent = '';
      post('/api/auth/verify-code', { email: address, code: code.value }).then(function (d) {
        clearInterval(timer);
        setToken(d.token); me = d.user; renderAccount(); loadList();
        var back = afterSignIn; afterSignIn = '#/';
        if (location.hash === back) route(); else location.hash = back;
      }).catch(function (err) {
        error.textContent = err.message;
        busy = false; setBusy(false); code.select();
      });
    }
    // Typing (or pasting) all 6 digits signs you in straight away.
    code.addEventListener('input', function () {
      var digits = code.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== code.value) code.value = digits;
      if (digits.length === 6) check();
    });
    form.onsubmit = function (e) { e.preventDefault(); check(); };
    show([paneHead('Sign in'), paneBody([form])]);
    code.focus();
  }

  // ---- Starting a topic -----------------------------------------------------------------
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
    pastePictures(input, status);
    var box = el('div', { class: 'editor' }, [input, preview, el('div', { class: 'help' }, [toggle, el('span', { text: HELP }), status])]);
    return { box: box, input: input };
  }

  function renderNew() {
    if (!me) { afterSignIn = '#/new'; location.hash = '#/signin'; return; }
    var error = el('div', { class: 'error', role: 'alert' });
    var title = el('input', { type: 'text', placeholder: 'A short title', required: 'required', maxlength: '120', 'aria-label': 'Title' });
    var label = el('select', { 'aria-label': 'Label' }, [
      el('option', { value: 'question', text: 'Question' }),
      el('option', { value: 'idea', text: 'Idea' }),
      el('option', { value: 'bug', text: 'Bug' })
    ]);
    var ed = editor('Tell us more. Paste links or code if it helps.', 8);
    var go = el('button', { class: 'primary', type: 'submit', text: 'Post topic' });
    var setBusy = busyButton(go, 'Posting…');
    var form = el('form', { class: 'write' }, [el('div', { class: 'row' }, [title, label]), ed.box, error, go]);
    var busy = false;
    form.onsubmit = function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true; setBusy(true); error.textContent = '';
      post('/api/topics', { title: title.value, label: label.value, body: ed.input.value }).then(function (d) {
        loadList();
        if (d.held) return show([paneHead('New topic'), paneBody([el('div', { class: 'empty', text: HELD_NOTE })])]);
        location.hash = '#/topic/' + d.id;
      }).catch(function (err) { error.textContent = err.message; busy = false; setBusy(false); });
    };
    show([paneHead('New topic'), paneBody([form])]);
    title.focus();
  }

  // ---- Moving around ----------------------------------------------------------------------
  function route() {
    chat = null;
    var id = openTopicId();
    var home = !location.hash || location.hash === '#' || location.hash === '#/';
    shell.classList.toggle('detail', !home); // on a phone: show the right side instead of the list
    drawList();
    if (id) renderTopic(id);
    else if (location.hash === '#/new') renderNew();
    else if (location.hash === '#/owner') renderOwnerRoom();
    else if (location.hash === '#/signin') renderSignIn();
    else renderWelcome();
  }
  window.addEventListener('hashchange', route);

  // New messages and topics show up by themselves while the board is open.
  setInterval(function () {
    if (document.hidden) return;
    loadList();
    refreshChat(false);
  }, 15000);

  drawTools();
  loadMe().then(function () { renderAccount(); loadList(); route(); });
})();
