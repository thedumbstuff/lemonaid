const MarkdownIt = require('markdown-it');

// Turns what people type (bold, links, `code`, code blocks) into safe HTML.
// html:false means any HTML a person types is shown as plain text, never run.
// markdown-it also refuses links like javascript:... on its own.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Links open in a new tab, and can't reach back into the page that opened them.
const defaultLink = md.renderer.rules.link_open || ((tokens, i, opts, env, self) => self.renderToken(tokens, i, opts));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener noreferrer nofollow ugc');
  return defaultLink(tokens, i, opts, env, self);
};

// Pictures: only ones saved by Lemonaid itself (/uploads/<name>) are shown. Any other
// picture address is shown as plain text, so nobody can load outside images or trackers.
const OWN_IMAGE = /^\/uploads\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
md.renderer.rules.image = (tokens, i) => {
  const src = tokens[i].attrGet('src') || '';
  const alt = md.utils.escapeHtml(tokens[i].content || 'picture');
  if (!OWN_IMAGE.test(src)) return alt;
  return `<img src="${src}" alt="${alt}" loading="lazy">`;
};

function renderMarkdown(text) {
  return md.render(String(text));
}

module.exports = { renderMarkdown };
