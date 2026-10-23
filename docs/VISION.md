# post2md

> A Chrome extension that adds a **Download as Markdown** button to any post on X (formerly Twitter) — including full threads, media references and author metadata.

X is a terrible place to keep knowledge: posts disappear, threads collapse, and copy-paste loses structure, links and authorship. `post2md` turns a post (or an entire thread) into a clean, portable `.md` file you can drop into Obsidian, Notion, a repo, or your own notes.

## The problem

There is no native way to export a single post from X. Bookmarking inside the platform is a one-way trap: content can be deleted, accounts can be locked, and the reading experience is hostile to long-form threads. Existing tools either require a paid API, scrape your whole account, or produce unreadable HTML dumps.

## The solution

One button. Injected next to the native action bar of every post, it captures the post straight from the DOM you are already looking at — no API keys, no account access, no backend.

## Features

- **One-click export** — the button lives in each post's action bar, right where you would expect it.
- **Full thread support** — exporting any post of a thread walks the conversation and produces a single document with every tweet in order, not a folder of fragments.
- **Faithful content** — post text is kept as-is, with line breaks, lists, emoji and inline links preserved.
- **Author metadata** — display name, handle, profile URL and post timestamp, formatted as front matter.
- **Media handling** — images, videos and GIFs are referenced with their source URLs and alt text when available; direct download of binaries is optional.
- **Quoted posts and link previews** — embedded quotes become blockquotes, and external links are kept intact.
- **Front matter** — YAML header with source URL, author, date, language and thread flag, so notes stay queryable in Obsidian and similar tools.
- **Local-only by default** — everything runs in the content script; no data leaves the browser.

## Example output

```markdown
---
source: https://x.com/user/status/1234567890
author: Jane Doe (@janedoe)
published: 2026-10-22T14:03:00Z
thread: true
tweets: 3
---

# Jane Doe (@janedoe) — 2026-10-22

Long posts deserve better than a screenshot. Here is the whole idea:

1. Capture the post you are reading
2. Keep the thread order
3. Ship it to your notes

> **Quoted post** — @someoneelse: the original claim being discussed
> https://x.com/someoneelse/status/0987654321

![Image: chart of weekly exports](https://pbs.twimg.com/media/example.jpg)
```

## How it works

1. A content script matches `x.com` and `twitter.com` and observes the timeline for post containers.
2. Each post gets a small, unobtrusive button appended to its action bar.
3. On click, the script extracts the tweet's structured data from the rendered DOM (text nodes, media, quoted post, author block).
4. If the post belongs to a thread, the script follows the conversation and collects the remaining posts in chronological order.
5. The result is serialized to Markdown, wrapped in front matter, and handed to `chrome.downloads` as a `.md` file named after the author, date and post ID.

No server, no OAuth, no scraping backend. The extension reads only what is already rendered on screen.

## Project status

Idea and specification stage. This repository documents the intended behaviour and the design decisions before implementation starts.

## Roadmap

- [ ] Manifest V3 scaffold with a single content script
- [ ] Post detection that survives X's frequent DOM churn
- [ ] Action-bar button injection with light/dark theming
- [ ] Markdown serializer for single posts
- [ ] Thread traversal and ordering
- [ ] Media handling (URL references, optional binary download)
- [ ] YAML front matter and filename templating
- [ ] Options page: toggles for front matter, media download and thread depth
- [ ] Packaged build and Chrome Web Store submission

## Non-goals

- Bulk export of an account's timeline or bookmarks.
- Authenticating with the X API or storing credentials.
- Scraping private accounts or content the user cannot already see.

## Tech notes

- Manifest V3, vanilla TypeScript, no build-heavy framework.
- Content script only: the `downloads` permission plus host access to `x.com`.
- Markdown generation lives in a pure function so it can be unit-tested without a browser.
- DOM selectors are isolated in a single adapter module, because X changes them constantly.

## Naming

`post` because X calls them posts now, `md` because Markdown is the only output that matters.

---

## Resumen en español

Extensión de Chrome que agrega un botón **Descargar como Markdown** en cada post de X. Al hacer clic, guarda el contenido completo como un archivo `.md`: texto con su formato, autor, fecha, imágenes y enlaces, y si el post pertenece a un hilo, todos sus tuits en orden. Todo ocurre localmente en el navegador, sin backend ni claves de API, para que puedas llevarte lo que lees a Obsidian, Notion o tu propio repositorio.
