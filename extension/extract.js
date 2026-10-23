/* DOM-only extraction. No fetching, conversion, or mutation of the live page. */
(function (scope) {
  'use strict';
  const TWEET = '[data-testid="tweet"]';
  // Native anchors (timestamps and linked media) are not quote containers.
  const QUOTE = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]:not(a)';
  const CARD = '[data-testid="card.wrapper"]';
  const UI = '[role="group"], button, [data-testid="Tweet-User-Avatar"], [data-testid="UserAvatar-Container"], [data-testid="socialContext"], [data-testid="placementTracking"], [data-post2md]';
  const text = (element) => {
    const clone = element.cloneNode(true);
    for (const image of clone.querySelectorAll('img[alt]')) image.replaceWith(image.getAttribute('alt'));
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };
  function identity(href, base, type = 'status') {
    try {
      const url = new URL(href, base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
          !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(url.hostname)) return null;
      const pattern = type === 'status'
        ? /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/
        : /^\/(i|[A-Za-z0-9_]{1,15})\/article\/(\d+)\/?$/;
      const match = url.pathname.match(pattern);
      return match ? { id: match[2], author: match[1] === 'i' && type === 'article' ? null : match[1], url: `https://x.com/${match[1]}/${type}/${match[2]}` } : null;
    } catch { return null; }
  }
  function own(element, tweet) {
    if (element.closest(TWEET) !== tweet) return false;
    for (let node = element.parentElement; node && node !== tweet; node = node.parentElement) {
      if (node.matches(`${QUOTE}, ${CARD}`)) return false;
    }
    return true;
  }
  function postIdentity(tweet, pageUrl) {
    for (const time of tweet.querySelectorAll('time')) {
      if (!own(time, tweet)) continue;
      const anchor = time.closest('a[href]');
      const result = anchor && identity(anchor.getAttribute('href'), pageUrl);
      if (result) return { ...result, publishedAt: time.getAttribute('datetime') || null };
    }
    return null;
  }
  function cleanClone(element, pageUrl) {
    const clone = element.cloneNode(true);
    for (const unwanted of clone.querySelectorAll(UI)) unwanted.remove();
    // Resolve only against the explicit source page, never the document's baseURI.
    for (const node of [clone, ...clone.querySelectorAll('[href], [src], [poster]')]) {
      for (const attribute of ['href', 'src', 'poster']) {
        const value = node.getAttribute(attribute);
        if (value === null) continue;
        try {
          if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid URL');
          const url = new URL(value, pageUrl);
          const protocols = attribute === 'href' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
          if (!protocols.includes(url.protocol)) throw new Error('Unsafe protocol');
          node.setAttribute(attribute, url.href);
        } catch { node.removeAttribute(attribute); }
      }
    }
    return clone;
  }
  function extractPost(element, pageUrl) {
    const tweet = element?.matches?.(TWEET) ? element : element?.closest?.(TWEET);
    if (!tweet || tweet.closest('[data-testid="placementTracking"]')) return null;
    const meta = postIdentity(tweet, pageUrl);
    if (!meta) return null;
    const content = tweet.ownerDocument.createElement('div');
    const selector = `[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], ${CARD}, ${QUOTE}`;
    const picked = [];
    for (const node of tweet.querySelectorAll(selector)) {
      if (node.closest(TWEET) !== tweet || node.closest(UI)) continue;
      if (node.matches('[role="link"]') && !node.querySelector('[data-testid="tweetText"]')) continue;
      if (picked.some((parent) => parent.contains(node))) continue;
      picked.push(node);
      content.append(cleanClone(node, pageUrl));
    }
    if (!content.childNodes.length) return null;
    const ownText = [...tweet.querySelectorAll('[data-testid="tweetText"]')].find((node) => own(node, tweet));
    return { ...meta, title: ownText ? text(ownText).slice(0, 160) : `Post by @${meta.author}`, content };
  }
  const READ = '[data-testid="twitterArticleReadView"]';
  const BODY = '[data-testid="twitterArticleRichTextView"], [data-testid="articleBody"], [class*="longform-body"], [class*="longform-content"], [class*="longform-richText"], [data-block="true"]';
  function extractArticle(root, pageUrl) {
    if (!root?.querySelector) return null;
    const pageArticle = identity(pageUrl, pageUrl, 'article');
    const owner = root.closest?.(TWEET) || null;
    const excluded = `${UI}, ${QUOTE}, ${CARD}`;
    const reads = root.matches?.(READ) ? [root] : [...root.querySelectorAll(READ)];
    const read = reads.find((node) => {
      const tweet = node.closest(TWEET);
      if (!owner && tweet?.parentElement?.closest(TWEET)) return false;
      return own(node, owner || tweet) && !node.closest(excluded);
    });
    // A rich body on an article route is sufficient; a status requires an actual read view.
    const container = read || (pageArticle ? root : null);
    if (!container || container.closest?.(`${QUOTE}, ${CARD}, [data-testid="placementTracking"]`)) return null;
    const tweet = container.closest?.(TWEET) || null;
    const inContext = (node) => own(node, tweet) && !node.closest(excluded);
    const meta = pageArticle || (tweet && postIdentity(tweet, pageUrl));
    if (!meta) return null;
    const bodies = [...container.querySelectorAll(BODY)].filter(inContext);
    if (container.matches?.(BODY)) bodies.unshift(container);
    const topBodies = bodies.filter((node) => !bodies.some((other) => other !== node && other.contains(node)));
    if (!topBodies.some((node) => text(node) || node.querySelector('img, video'))) return null;
    const content = (container.ownerDocument || container).createElement('div');
    const outsideBody = (node) => !topBodies.some((body) => body.contains(node));
    const titleNode = [...container.querySelectorAll('h1, h2, [role="heading"], [data-testid="twitterArticleTitle"], [data-testid="twitter-article-title"], [data-testid="articleTitle"]')].find((node) => outsideBody(node) && inContext(node))
      || [...container.children].find((node) => node.matches('[dir="auto"]') && outsideBody(node) && inContext(node));
    const picked = [];
    const candidates = [...container.querySelectorAll(`${BODY}, img, video, audio, iframe`)];
    if (topBodies.includes(container)) candidates.unshift(container);
    for (const node of candidates) {
      if (!inContext(node) || titleNode?.contains(node)) continue;
      if (!topBodies.includes(node) && (!outsideBody(node) || !node.matches('img, video, audio, iframe'))) continue;
      if (picked.some(parent => parent.contains(node))) continue;
      picked.push(node);
      const clone = cleanClone(node, pageUrl);
      // Captured DraftJS emphasis is inline CSS; normalize only the detached body.
      if (topBodies.includes(node)) {
        for (const span of clone.querySelectorAll('span[style]')) {
          if (span.closest('pre, code')) continue;
          for (const [property, value, tag] of [['font-weight', 'bold', 'strong'], ['font-style', 'italic', 'em']]) {
            if (span.style.getPropertyValue(property) !== value) continue;
            const mark = clone.ownerDocument.createElement(tag);
            mark.append(...span.childNodes);
            span.append(mark);
          }
        }
      }
      // Keep body children so downstream Markdown sees original semantic blocks.
      if (topBodies.includes(node) && !node.matches('[data-block="true"]')) content.append(...clone.childNodes);
      else content.append(clone);
    }
    return { ...meta, publishedAt: meta.publishedAt || [...container.querySelectorAll('time[datetime]')].find(inContext)?.getAttribute('datetime') || null,
      title: titleNode ? text(titleNode) : 'X Article', content };
  }
  function extractThread(document, selectedPost, pageUrl) {
    const page = identity(pageUrl, pageUrl);
    const selected = selectedPost?.matches?.(TWEET) ? selectedPost : selectedPost?.closest?.(TWEET);
    const column = selected?.closest('[data-testid="primaryColumn"]');
    const seed = selected && extractPost(selected, pageUrl);
    if (!page || !column || !seed || seed.id !== page.id || !document.contains(column)) return [];
    const entries = [];
    const seen = new Set();
    // Headings and recommendation/promoted cells form hard segment boundaries.
    const boundary = 'h2, [role="heading"], [data-testid="placementTracking"], [data-testid="recommendations"], [data-testid="UserCell"]';
    for (const node of column.querySelectorAll(`${TWEET}, ${boundary}`)) {
      if (node.matches(TWEET)) {
        if (node.parentElement?.closest(TWEET)) continue;
        const record = extractPost(node, pageUrl);
        if (!record || record.author.toLowerCase() !== seed.author.toLowerCase()) { entries.push(null); continue; }
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        entries.push({ node, record });
      } else if (!node.closest(TWEET)) entries.push(null);
    }
    const index = entries.findIndex((entry) => entry?.record.id === seed.id);
    if (index < 0) return [];
    function repliesTo(child, parent) {
      if (!child || !parent) return false;
      if (child.node.getAttribute('data-in-reply-to-status-id') === parent.record.id) return true;
      return [...child.node.querySelectorAll('[data-testid="replyContext"] a[href]')].some((anchor) => {
        const target = own(anchor, child.node) && identity(anchor.getAttribute('href'), pageUrl);
        return target && target.id === parent.record.id && target.author.toLowerCase() === parent.record.author.toLowerCase();
      });
    }
    // X does not always expose reply ancestry. In that case return only the selected
    // post, not a same-author timeline guessed to be a complete thread.
    let start = index;
    let end = index;
    while (start > 0 && repliesTo(entries[start], entries[start - 1])) start--;
    while (end + 1 < entries.length && repliesTo(entries[end + 1], entries[end])) end++;
    return entries.slice(start, end + 1).map((entry) => entry.record);
  }
  const api = { extractPost, extractArticle, extractThread };
  scope.Post2md = Object.assign(scope.Post2md || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
