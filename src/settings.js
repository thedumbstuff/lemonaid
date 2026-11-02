const fs = require('node:fs');

// Settings from a file: SECRETS_FILE=/path/to/settings.json reads a JSON object such as
//   { "SMTP_URL": "smtps://user:password@smtp.example.com:465", "ANTHROPIC_API_KEY": "..." }
// and uses each value as if it had been set in the environment. Useful on servers that hand
// secrets to programs as files (Docker secrets, a mounted folder) instead of variables.
// A setting already in the environment wins over the file.
//
// A missing file is only a warning (the parts that need it stay off, as without the setting);
// a file that is not a JSON object stops Lemonaid, so a typo never goes unnoticed.
function loadSettingsFile(env = process.env, log = console) {
  const file = env.SECRETS_FILE;
  if (!file) return [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    log.warn(`Warning: SECRETS_FILE ${file} could not be read (${err.code || err.message}). Carrying on without it.`);
    return [];
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SECRETS_FILE ${file} is not valid JSON.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`SECRETS_FILE ${file} must hold a JSON object, like {"SMTP_URL": "..."}.`);
  }
  const used = [];
  for (const [name, value] of Object.entries(data)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (env[name] !== undefined && env[name] !== '') continue;
    env[name] = String(value);
    used.push(name);
  }
  return used;
}

module.exports = { loadSettingsFile };
