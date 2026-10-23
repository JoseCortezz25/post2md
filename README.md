# post2md

A local-only Chrome extension for downloading loaded X posts, opened Articles and reliably connected loaded threads as Markdown.

The original project proposal is preserved in [docs/VISION.md](docs/VISION.md). It describes longer-term goals, not a list of already implemented capabilities; the installation instructions and limits below describe this version.

## Install (no npm or build required)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository's **`extension` directory** (not the repository root).
5. Reload any open X tabs. A **Download Markdown** button appears in supported posts' action areas and opened standalone Articles.

After updating the files, reload the extension on `chrome://extensions`, then reload X again. This is also required when updating to the opened-Article extraction fix; an already injected button still uses the old scripts until the X tab reloads.

## Use

- There is one **Download Markdown** button per supported post or standalone Article. No separate thread button or mode selection is needed.
- On click, the extension automatically prioritizes the full opened **Article**, then a reliably connected **loaded thread** on the selected status detail, otherwise the **individual post**. Threads include same-author posts only when explicit reply ancestry connects them; ambiguous or single-post cases fall back to the individual post. Load more connected replies and click the same button again to include them.
- Downloads use the title as a sanitized `.md` filename. The local status message means a browser download was **requested**, not proof that a file was saved. Check Chrome's downloads and any save prompt.

## Output and limits

Markdown preserves supported headings, paragraphs, links, emphasis, images, lists, quotes, code, tables and available media references in source order. Frontmatter contains the generation time (ISO UTC), title and source URL:

```markdown
---
generated_at: "2026-01-01T12:00:00.000Z"
title: "Portable notes"
url: "https://x.com/alice/status/10"
---

# Portable notes

[Source](https://x.com/alice/status/10) | Author: @alice | Published: 2026-01-01T11:00:00Z

Post or Article content goes here.
```

Source author and publication time appear in the body when available; publication time does not replace `generated_at`. Thread documents use the first connected record's title and URL as root metadata, mark themselves as a **loaded subset**, and include each record's source URL, author and available publication time. Markdown punctuation may be escaped in the actual output.

Honest limits:

- Only content currently present in the DOM is exported. This does not fetch or scroll to load a whole thread.
- Articles must be **opened in full**, not just shown as preview cards.
- Strict ancestry can yield only the selected post. Some layouts may have no usable download action area.
- Images, video and other media are **remote links**, not binary downloads or offline copies. Expiring/protected media URLs may stop working.
- Authentication, private accounts, restricted or deleted content are not bypassed.
- X selectors are fragile and may change. The fixtures and tests are not live authenticated X verification; signed-in browser compatibility remains unverified.

## Privacy and architecture

No secrets, API keys, OAuth, third-party extraction servers or API calls. No privileged Chrome permissions or extra `host_permissions`. Static Manifest V3 content scripts match HTTPS X/Twitter domains (including www/mobile variants), running in Chrome's default isolated world. Unsupported host redirects may need a tab reload.

Classic scripts load in order: `markdown.js`, `extract.js`, `content.js`, plus scoped `content.css`. There is no service worker, popup or bundler. Buttons use the live DOM on click, so recycled feed nodes do not retain a captured post. A coalesced observer discovers candidates without eagerly converting their content. Downloads use a UTF-8 Markdown Blob and a temporary anchor, then release the object URL after a delay—no `chrome.downloads` permission. The extension itself makes no network requests; opening exported remote media links is separate.

## Development

Node.js with npm is required only for development:

```sh
npm ci
npm test
npm run check
```

Tests use Node's test runner and linkedom. The content-script integration suite loads the real classic scripts in a VM with simulated X location and browser download/timer boundaries. It interacts with DOM buttons and checks files, metadata, retry feedback and dynamic/recycled content.

`tests/fixtures/opened-article.html` contains reduced user-supplied structural fragments, not the full capture or a live-X snapshot. Its regression covers native timestamp anchors, a nested Article title, linked cover/media and a DraftJS body with embedded posts. Embedded posts and preview cards must not supply the owning Article's identity, title or publication time.

For a manual local demo, serve this repository root with any static HTTP server and open `http://localhost:<port>/tests/fixtures/demo.html`. The fixture loads scripts directly from `../../extension/`; no build is needed. Its demo-only adapter supplies an X `pageURL` to extractors while `history.replaceState` keeps the real origin localhost. It changes the path to `/alice/status/10`; revisit the original fixture URL to reload. This does not expand the production host allowlist. Remote media URLs in the fixture are illustrative, not bundled assets. This demo is not evidence of authenticated live X behavior.
