(function () {
  var app = document.getElementById('app');

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
    return fetch(url).then(function (r) {
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

  function renderList() {
    getJson('/api/topics').then(function (data) {
      if (!data.topics.length) {
        return show([newTopicButton(), el('div', { class: 'empty', text: 'No topics yet. Be the first to start one.' })]);
      }
      show([newTopicButton()].concat(data.topics.map(function (t) {
        return el('a', { class: 'topic-row', href: '#/topic/' + t.id }, [
          el('div', { class: 'title', text: t.title }),
          el('div', { class: 'meta' }, [
            pill(t.label), pill(t.status),
            el('span', { text: t.reply_count + (t.reply_count === 1 ? ' reply' : ' replies') }),
            el('span', { text: 'by ' + t.author + ' · ' + when(t.created_at) })
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
        el('h2', { text: t.title }),
        el('div', { class: 'meta' }, [pill(t.label), pill(t.status), el('span', { text: 'by ' + t.author + ' · ' + when(t.created_at) })]),
        rich('post md', t.body_html)
      ];
      if (data.replies.length) {
        nodes.push(el('h3', { text: data.replies.length + (data.replies.length === 1 ? ' reply' : ' replies') }));
        data.replies.forEach(function (r) {
          nodes.push(el('div', { class: 'post reply' }, [
            el('div', { class: 'meta', text: r.author + ' · ' + when(r.created_at) }),
            rich('md', r.body_html)
          ]));
        });
      }
      nodes.push(replyBox(id));
      show(nodes);
    }).catch(function () {
      show([el('a', { class: 'back', href: '#/', text: '← All topics' }), el('div', { class: 'empty', text: 'That topic could not be found.' })]);
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
      box.replaceChildren(el('span', { text: 'Signed in as ' + me.name }), out);
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
      post('/api/topics/' + topicId + '/replies', { body: ed.input.value }).then(function () {
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
    else if (location.hash === '#/signin') renderSignIn();
    else renderList();
  }
  window.addEventListener('hashchange', route);
  loadMe().then(function () { renderAccount(); route(); });
})();
