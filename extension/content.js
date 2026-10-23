/* Classic isolated-world content script; all content stays local. */
(function () {
  'use strict';
  const api = globalThis.Post2md;
  const TWEET = '[data-testid="tweet"]';
  let status;
  function feedback(message) {
    if (!status?.isConnected) {
      status = document.createElement('div');
      status.setAttribute('data-post2md', 'status');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      document.body.append(status);
    }
    status.textContent = message;
  }
  function download(record) {
    const blob = new Blob([api.serialize(record)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
      anchor.href = url;
      anchor.setAttribute('download', api.filename(record.title));
      anchor.hidden = true;
      anchor.setAttribute('data-post2md', 'download');
      document.body.append(anchor);
      anchor.click();
      feedback('Markdown download requested. Check your browser downloads.');
    } finally {
      anchor.remove();
      // Give the browser time to consume the Blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
  function source(record) {
    const content = record.content.ownerDocument.createElement('div');
    const meta = content.ownerDocument.createElement('p');
    const link = content.ownerDocument.createElement('a');
    link.setAttribute('href', record.url);
    link.textContent = 'Source';
    meta.append(link, `${record.author ? ` | Author: @${record.author}` : ''}${record.publishedAt ? ` | Published: ${record.publishedAt}` : ''}`);
    content.append(meta, record.content.cloneNode(true));
    return content;
  }
  function addButton(host, kind = 'post') {
    if (host.querySelector(`[data-post2md="${kind}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-post2md', kind);
    button.textContent = 'Download Markdown';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const tweet = button.closest(TWEET);
        if (kind === 'article' && articleRoutes.get(host) !== location.href) throw new Error('The page changed. Reopen the full article.');
        const article = api.extractArticle(kind === 'article' ? host : tweet, location.href);
        if (article) {
          download({ ...article, content: source(article) });
          return;
        }
        const records = tweet ? api.extractThread(document, tweet, location.href) : [];
        if (records.length > 1) {
          const content = document.createElement('div');
          const note = document.createElement('p');
          note.textContent = 'Loaded subset only: reliably connected posts currently present in the page; not necessarily the whole thread.';
          content.append(note);
          for (const record of records) content.append(source(record));
          download({ title: records[0].title, url: records[0].url, content });
          return;
        }
        const record = tweet && api.extractPost(tweet, location.href);
        if (!record) throw new Error('No supported loaded content found. Open the full post or article and retry.');
        download({ ...record, content: source(record) });
      } catch (error) {
        feedback(`Could not request Markdown download: ${error.message} You can retry.`);
      }
    });
    host.append(button);
  }
  const articleRoutes = new Map();
  const READ = '[data-testid="twitterArticleReadView"]';
  const BODY = '[data-testid="twitterArticleRichTextView"], [data-testid="articleBody"], [class*="longform-body"], [class*="longform-content"], [class*="longform-richText"]';
  // Never inject controls into interactive hosts or quoted content.
  const EXCLUDED = 'a, button, [role="link"]:not(a), [data-testid="quoteTweet"], [data-testid="quotedTweet"], [data-testid="card.wrapper"], [data-testid="placementTracking"]';
  function discover(root) {
    if (!root?.querySelectorAll) return;
    const tweets = [...root.querySelectorAll(TWEET)];
    if (root.matches?.(TWEET)) tweets.unshift(root);
    const parent = root.closest?.(TWEET);
    if (parent && !tweets.includes(parent)) tweets.push(parent);
    for (const tweet of tweets) {
      if (tweet.parentElement?.closest(TWEET) || tweet.closest(EXCLUDED)) continue;
      const group = [...tweet.querySelectorAll('[role="group"]')].find(node => node.closest(TWEET) === tweet && !node.closest(EXCLUDED));
      if (!group) continue;
      addButton(group);
    }
    const candidates = [...root.querySelectorAll(`${READ}, ${BODY}`)];
    if (root.matches?.(`${READ}, ${BODY}`)) candidates.unshift(root);
    for (const candidate of candidates) {
      const host = candidate.closest(READ) || candidate;
      if (host.closest(TWEET) || host.closest(EXCLUDED) || !/\/article\/\d+\/?$/.test(new URL(location.href).pathname)) continue;
      if (host !== candidate || (!host.matches(READ) && host.parentElement?.closest(BODY))) continue;
      articleRoutes.set(host, location.href);
      addButton(host, 'article');
    }
  }
  function prune() {
    for (const [host, route] of articleRoutes) {
      if (!host.isConnected || route !== location.href) {
        host.querySelector('[data-post2md="article"]')?.remove();
        articleRoutes.delete(host);
      }
    }
  }
  discover(document);
  let scheduled = false;
  let lastURL = location.href;
  const pending = new Set();
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.target.closest?.('[data-post2md]')) continue;
      const changed = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
      if (changed.length && changed.every(node => node.nodeType === 1 && node.matches('[data-post2md]'))) continue;
      pending.add(mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement);
    }
    if (scheduled || !pending.size) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      prune();
      const roots = location.href !== lastURL ? [document.body] : [...pending].filter(root => root?.isConnected);
      lastURL = location.href;
      pending.clear();
      for (const root of roots) if (!roots.some(other => other !== root && other.contains(root))) discover(root);
    }, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['href', 'data-testid', 'role', 'data-in-reply-to-status-id'] });
})();
