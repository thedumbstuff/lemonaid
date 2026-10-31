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

  function renderList() {
    getJson('/api/topics').then(function (data) {
      if (!data.topics.length) {
        return show([el('div', { class: 'empty', text: 'No topics yet. Questions, ideas and problems will show up here.' })]);
      }
      show(data.topics.map(function (t) {
        return el('a', { class: 'topic-row', href: '#/topic/' + t.id }, [
          el('div', { class: 'title', text: t.title }),
          el('div', { class: 'meta' }, [
            pill(t.label), pill(t.status),
            el('span', { text: t.reply_count + (t.reply_count === 1 ? ' reply' : ' replies') }),
            el('span', { text: 'by ' + t.author + ' · ' + when(t.created_at) })
          ])
        ]);
      }));
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
        el('div', { class: 'post', text: t.body })
      ];
      if (data.replies.length) {
        nodes.push(el('h3', { text: data.replies.length + (data.replies.length === 1 ? ' reply' : ' replies') }));
        data.replies.forEach(function (r) {
          nodes.push(el('div', { class: 'post reply' }, [
            el('div', { class: 'meta', text: r.author + ' · ' + when(r.created_at) }),
            el('div', { text: r.body })
          ]));
        });
      }
      show(nodes);
    }).catch(function () {
      show([el('a', { class: 'back', href: '#/', text: '← All topics' }), el('div', { class: 'empty', text: 'That topic could not be found.' })]);
    });
  }

  function route() {
    var m = location.hash.match(/^#\/topic\/(\d+)$/);
    if (m) renderTopic(m[1]); else renderList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
