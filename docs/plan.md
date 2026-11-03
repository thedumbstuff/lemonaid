# Plan: Lemonaid

Lemonaid is one small program that a website owner runs. It serves the board itself and a
tiny script. The owner puts one line on their website, and the board appears there inside
a frame (a window into another page). The board keeps its own look and can't break the
owner's site. The board also works at its own address.

## Screens

### Demo website
A pretend product website with the board placed on it using the one line, plus that line
ready to copy. This is what opens when you press **Open it**, so you see exactly what an
owner's visitors will see.

The board looks like a chat app (like WhatsApp): the topic list on the left, the open topic
on the right. On a phone or in a narrow column, one side shows at a time, with a back arrow.
Inside a website it is a window 640 pixels tall (the owner can change it).

### The board (topic list)
Every topic, listed like a chat: an icon for its label (bug, idea, question), its title, its
latest message and when, its upvotes and status, and how many new replies you have not seen.
Sort by latest activity, most wanted or newest, filter by label or status, search, and a
**New** button. Anyone can read it without signing in.

### A topic
Like a group chat: the topic is pinned at the top (long ones fold, with "Show all"), and the
discussion is below it as chat bubbles, yours on the right, with the day between them. You
write at the bottom (Enter sends, a paperclip adds a picture), and new replies appear by
themselves. You can upvote it from the top bar. The owner also sees buttons to change the status, delete
posts and flag the person who wrote them.

### Sign in
Type your email, get a 6-digit code, type the code. That's it, with no passwords. The button
locks and says "Sending the code…" after one press, typing the 6th digit signs you in, and a
new code can be asked for after 30 seconds. You stay
signed in on that device. You can also turn reply emails off here.

### Write a topic
A title, a label, and a text box. Paste a screenshot straight in, or add a link or a piece
of code. A preview shows how it will look. If the bad-word check stops it, it says why in
a friendly way. Each person can start up to 5 topics in any 24 hours (the owner has no
limit; replies are not limited). The 6th says kindly when they can post again.

### Owner's room
Only for the owner, whose email is set in the settings. It lists posts the checks held
back (the owner can let them through or delete them), recently deleted posts, and people.
People can be flagged (marked as a problem) or blocked from posting.

## What it keeps
All of it is in one database file (SQLite) and one folder of pictures, in the `data`
folder of the owner's copy:
- People: their email address, whether they want reply emails, and whether they are
  flagged or blocked. Email addresses are never shown publicly. Posts show a short name
  taken from the email (for example "ana").
- Topics and replies, with their labels, statuses and upvotes.
- Screenshots people pasted, up to 5 MB each.
- Sign-in codes, which only last 10 minutes.

Everything people post is public, as you asked. Email addresses stay private.

## Tools we use
- Node.js: already on this computer, and almost every server can run it.
- Express: the most common, simplest way to make a small web server in Node.js.
- SQLite (built into Node.js): keeps all the data in one file, so there is no database
  server to set up. Owners just copy one folder to back it up.
- Plain HTML, CSS and JavaScript for the screens: no build step, small and fast to load
  inside other sites.
- markdown-it: turns what people type (bold, links, code) into neat text safely, so nobody
  can sneak harmful code into a post.
- Nodemailer: sends the sign-in codes and reply emails through any email service. Without
  one set up, it uses a "test mailbox" page that shows the emails, so you can try
  everything on this computer.
- obscenity: a well-known, free bad-word checker that also catches tricks like "b4dw0rd".
- Claude (Anthropic): the optional AI check. Owners switch it on with their own key, and
  it costs a fraction of a cent per post.
- Node's built-in test runner: checks everything automatically, with nothing extra to
  install.
- MIT licence: the most common open-source licence. Anyone may use and change it, and
  you're not responsible for how they use it.

## What you need
Nothing else to build it and try it on this computer.

Later, for real use (these come up in the Ship step, not before):
- **An email-sending account**, so codes reach real inboxes. Brevo or Resend are free for
  a few hundred emails a day. You sign up on their website and get a few settings to
  copy in.
- **An Anthropic account** (console.anthropic.com), only if you want the AI check. It's
  paid per use and very cheap.
- **A place to put it online**: a small server. Covered in the Ship step.

## How we check it works
`npm test` runs automatic checks of the whole thing: reading the board, sign-in codes
(right code, wrong code, expired code, too many tries), posting topics and replies,
screenshots, the bad-word check stopping bad posts, upvotes, the owner's tools (status,
delete, flag, block), reply emails, and that nobody can post harmful code into a page.

## Sharing it
Two kinds of sharing:
- **The project itself**: open source, so the code goes in a public place (for example a
  public GitHub repository) with a guide on how an owner sets up their own copy. This is
  free.
- **Your own copy, online**: to use it on your own website, it has to run on a server.
  A small one costs about $5 a month (for example Hetzner or DigitalOcean), or it can go
  on the server you already use for your other sites. We decide this in the Ship step.
