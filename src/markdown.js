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

// Pictures come in a later task; for now an image is shown as its link.
md.disable('image');

function renderMarkdown(text) {
  return md.render(String(text));
}

module.exports = { renderMarkdown };
