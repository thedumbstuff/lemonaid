# 🍋 Lemonaid

A free, open-source discussion and issues board you can add to **any website with one line**.

Your visitors can ask questions, share ideas and report problems. Everything is public and
anyone can read it. To post, people sign in with just their email and a 6-digit code (no
passwords). You, the owner, can delete posts, flag or block troublemakers, and an automatic
check keeps rude posts out.

You run your own copy. There is no shared service and no sign-up with us: your board, your
data, your rules.

## What it does

- **Read without signing in.** Topics, replies, votes and statuses are all public.
- **Sign in with an email code.** No passwords. Emails are never shown to other people, only a
  short name made from the first part of the address (`ana.smith@example.com` shows as `ana.smith`).
- **Topics and replies** labelled Bug, Idea or Question, with **bold**, links, `code` and code blocks.
- **Up to 5 new topics a day per person** (replies are not limited; the owner has no limit). Change it with `TOPICS_PER_DAY`.
- **Paste screenshots** straight into a post (PNG, JPEG, GIF, WebP, up to 5 MB).
- **Upvotes**, sorting by most wanted or newest, and filters by label and status.
- **Statuses** (open, planned, fixed) that only the owner can set.
- **Reply emails** to the topic's author, with a one-click way to turn them off.
- **Owner's room:** delete and restore posts, flag people (their posts wait for you) or block them.
- **Rude-post check:** a built-in bad-word check, plus an optional AI check you can switch on.
- **Fits your site:** one colour you choose, works on phones, grows to the height of the board.

## Try it in two minutes

You need [Node.js](https://nodejs.org) 22.13 or newer. Then, in this folder:

```
npm install
npm start
```

Open <http://localhost:3000>. You will see a pretend product website with the board on it.

While you try it out, Lemonaid runs in **try-out mode**:

- Emails are not sent anywhere. They show up on the [test mailbox](http://localhost:3000/mailbox) page,
  so you can read your sign-in code there.
- The owner is `owner@lemonaid.local`. Sign in with that address to see the owner's tools.

## Add it to your website

Put this line where you want the board to appear (use your own address in place of `board.example.com`):

```html
<script src="https://board.example.com/lemonaid.js"></script>
```

To match your site, add your main colour:

```html
<script src="https://board.example.com/lemonaid.js" data-color="#0a7e5a"></script>
```

The demo page at your board's address has a colour picker that writes this line for you.

## Put it online for real

Run Lemonaid on any small server that can run Node.js (a $5 a month VPS is plenty), put it behind
a web address with HTTPS (Caddy, nginx, Traefik or similar), and set these settings. They are
read from the environment, or from a file called `.env` next to `package.json` (copy
`.env.example` to start; `.env` is never committed).

| Setting | What it is | Needed? |
|---|---|---|
| `NODE_ENV=production` | **Turns off try-out mode.** Hides the test mailbox and the demo owner. | Yes |
| `OWNER_EMAIL` | The email of the person who runs the board. Signing in with it gives the owner's tools. | Yes |
| `PUBLIC_URL` | The board's web address, like `https://board.example.com`. Used in email links. | Yes |
| `SMTP_URL` | Your email service, like `smtps://user:password@smtp.example.com:465`. | Yes (sign-in codes are emails) |
| `MAIL_FROM` | The sender, like `Lemonaid <hello@example.com>`. | Recommended |
| `TRUST_PROXY=1` | Set when you are behind a reverse proxy, so limits count each visitor, not the proxy. | If you use a proxy |
| `PORT` | Port to listen on (default 3000). | No |
| `DATA_DIR` | Where the database and pictures live (default `./data`). | No |
| `TOPICS_PER_DAY` | How many topics one person may start in any 24 hours (default 5). Replies are not limited. | No |
| `ACCENT_COLOR` | Default main colour like `"#0a7e5a"` (keep the quotes in a `.env` file), if the embed line has no `data-color`. | No |
| `ANTHROPIC_API_KEY` | Allows the optional AI check (see below). | No |
| `AI_MODEL` | Which Claude model the AI check uses (default `claude-opus-5-5`). | No |

**Important:** always set `NODE_ENV=production` online. As a safety net, the test mailbox only ever
opens for someone at the same computer (never through a proxy) and closes once `SMTP_URL` is set,
but try-out mode is still not meant for the internet. Lemonaid prints a reminder when it starts in it.

**Email.** Any email service that gives you an SMTP address works. Brevo and Resend both have free
plans of a few hundred emails a day. Without one in production, requesting a sign-in code fails
with a clear message instead of pretending to work.

**The AI check (optional).** Create a key at <https://console.anthropic.com>, set
`ANTHROPIC_API_KEY`, restart, then open the Owner's room and press *Switch on*. New posts are then
read by Claude first, and ones that look like harassment, hate, threats, scams or spam wait for you
with a short reason, even if they contain no swear words. It costs a fraction of a cent per post.
If the AI service is unreachable, posts are published as normal and the problem is logged.

**Backups.** Everything lives in `DATA_DIR`: the database `lemonaid.db` and the folder `images`.
Copy that folder to back up.

## How people are kept safe

- Posts are turned into safe HTML on the server. Any HTML someone types is shown as plain text.
- Only pictures saved by Lemonaid itself are shown (checked by their real file type, never SVG),
  so nobody can load outside images or trackers.
- Sign-in codes last 10 minutes, work once, and stop working after 5 wrong tries. Each email can ask
  for 5 codes an hour, and each visitor address for 20.
- Blocked people can read but not post, vote or add pictures. Flagged people's posts wait for you.
- Email addresses and who-wrote-what are visible to the owner only.

## For developers

```
npm test        # runs all automatic checks (no internet or accounts needed)
npm start       # starts the board on http://localhost:3000
```

- `src/` is the server (Express, with Node's built-in SQLite). Start with `src/app.js`.
- `public/board/` is the board itself (plain HTML, CSS and JavaScript, no build step).
- `public/lemonaid.js` is the one line site owners add. `public/demo/` is the demo site.
- `test/` has the checks. They use a pretend email service and a pretend AI service.
- `docs/` holds the original idea and plan.

Contributions are welcome. Please keep it simple: no build step, few dependencies, and add a
check for what you change.

## Licence

[MIT](LICENSE): free to use, change and share, for any purpose.
