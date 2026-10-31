const {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} = require('obscenity');

// The built-in bad-word check. It also sees through simple tricks like "b4dw0rd" or "baaadword"
// and it does not trip over innocent words that merely contain a bad one ("Scunthorpe").
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

// Looks at the pieces of a post (title, text...). Returns { ok: true } or { ok: false, reason }.
function checkText(...parts) {
  const text = parts.filter((p) => typeof p === 'string').join('\n');
  if (matcher.hasMatch(text)) {
    return {
      ok: false,
      reason: 'Your post was not published because it seems to contain rude or offensive language. Please reword it and try again.',
    };
  }
  return { ok: true };
}

module.exports = { checkText };
