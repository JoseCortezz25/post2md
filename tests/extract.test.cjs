const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { extractPost, extractArticle, extractThread } = require('../extension/extract.js');
const { serialize } = require('../extension/markdown.js');
const dom = (html) => parseHTML(`<html><body>${html}</body></html>`).document;
const tweet = (id, author = 'Alice', extra = '', attrs = '') => `<article data-testid="tweet" ${attrs}>
  <div data-testid="Tweet-User-Avatar"><img src="avatar.jpg"></div>
  <a href="/${author}/status/${id}?s=20"><time datetime="2026-01-01T00:00:00Z">today</time></a>
  <div data-testid="tweetText">Post ${id}<img alt="😀" src="emoji.png"></div>${extra}
  <div role="group"><button>Like</button></div></article>`;

test('post identity comes from its timestamp, and ordered content is cloned without UI', () => {
  const document = dom(tweet('123', 'Alice', '<div data-testid="tweetPhoto"><img src="photo.jpg"></div><div data-testid="card.wrapper"><a href="https://example.com">Resource</a></div>'));
  const original = document.body.innerHTML;
  const element = document.querySelector('article');
  const record = extractPost(element, 'https://twitter.com/Alice/status/123/photo/1?q=x#top');
  assert.deepEqual({ id: record.id, author: record.author, url: record.url, publishedAt: record.publishedAt }, {
    id: '123', author: 'Alice', url: 'https://x.com/Alice/status/123', publishedAt: '2026-01-01T00:00:00Z'
  });
  assert.equal(record.title, 'Post 123😀');
  assert.equal(record.content.querySelector('img').alt, '😀');
  assert.deepEqual([...record.content.querySelectorAll('img')].map((img) => img.getAttribute('src')), ['https://twitter.com/Alice/status/123/photo/emoji.png', 'https://twitter.com/Alice/status/123/photo/photo.jpg']);
  assert.ok(record.content.textContent.indexOf('Post') < record.content.textContent.indexOf('Resource'));
  assert.equal(record.content.textContent.includes('Like'), false);
  assert.equal(document.body.innerHTML, original);
  assert.notEqual(record.content.querySelector('[data-testid="tweetText"]'), element.querySelector('[data-testid="tweetText"]'));
});

test('quotes remain content but never supply the owning status identity', () => {
  const quote = '<div data-testid="quoteTweet"><a href="/Bob/status/999"><time>yesterday</time></a><div data-testid="tweetText">Quoted words</div></div>';
  const document = dom(tweet('123', 'Alice', quote));
  const record = extractPost(document.querySelector('article'), 'https://x.com/home');
  assert.equal(record.id, '123');
  assert.equal(record.content.textContent.includes('Quoted words'), true);
  const missing = dom(`<article data-testid="tweet">${quote}</article>`);
  assert.equal(extractPost(missing.querySelector('article'), 'https://x.com/home'), null);
});

test('unavailable, promoted, and non-X identities cannot be exported', () => {
  assert.equal(extractPost(null, 'https://x.com/home'), null);
  for (const href of ['https://x.com.evil.test/Alice/status/123', 'https://evil.test/Alice/status/123', 'javascript:alert(1)', 'https://x.com@evil.test/Alice/status/123']) {
    const document = dom(tweet('123').replace('/Alice/status/123?s=20', href));
    assert.equal(extractPost(document.querySelector('article'), 'https://x.com/home'), null);
  }
  const promoted = dom(`<div data-testid="placementTracking">${tweet('123')}</div>`);
  assert.equal(extractPost(promoted.querySelector('article'), 'https://x.com/home'), null);
});

test('full loaded articles preserve rich source order and exclude preview-only cards', () => {
  const document = dom(`<main><div data-testid="twitterArticleReadView"><h1>Deep article</h1>
    <div data-testid="twitterArticleRichTextView"><h2>Section</h2><p>Paragraph <a href="https://example.com">link</a></p>
    <img src="photo.jpg"><ul><li>Item</li></ul><blockquote>Quote</blockquote><pre><code>const x = 1;</code></pre></div></div></main>`);
  const before = document.body.innerHTML;
  const record = extractArticle(document, 'https://twitter.com/i/article/456?ref=foo#top');
  assert.equal(record.url, 'https://x.com/i/article/456');
  assert.equal(record.id, '456');
  assert.equal(record.title, 'Deep article');
  assert.deepEqual([...record.content.children].map((node) => node.localName), ['h2', 'p', 'img', 'ul', 'blockquote', 'pre']);
  assert.equal(document.body.innerHTML, before);
  assert.equal(extractArticle(dom('<div data-testid="card.wrapper"><h1>Preview</h1><p>Excerpt</p></div>'), 'https://x.com/i/article/456'), null);
  assert.equal(extractArticle(document, 'https://x.com.evil.test/i/article/456'), null);
});

test('article download includes outside-body media once in source order without title or UI duplication', () => {
  const document = dom(`<section data-testid="twitterArticleReadView"><h1>Covered article</h1>
    <div data-testid="Tweet-User-Avatar"><img src="https://example.com/avatar.png"></div>
    <figure><img src="https://example.com/cover.png" alt="Cover"></figure>
    <div data-testid="articleBody"><p>Body</p><img src="https://example.com/body.png" alt="Body"></div>
    <video src="https://example.com/after.mp4"></video>
    <div role="group"><img src="https://example.com/action.png"><button>Share</button></div></section>`);
  const before = document.body.innerHTML;
  const markdown = serialize(extractArticle(document, 'https://x.com/i/article/456'));
  const destinations = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.deepEqual(destinations, ['https://example.com/cover.png', 'https://example.com/body.png', 'https://example.com/after.mp4']);
  assert.equal(markdown.match(/^# Covered article$/gm)?.length, 1);
  assert.doesNotMatch(markdown, /avatar|action|Share/);
  assert.equal(document.body.innerHTML, before);
});

test('post serialization resolves relative links and quoted sources using the explicit page URL only', () => {
  const document = dom(tweet('123', 'Alice', `<div data-testid="quoteTweet">
    <a href="/bob/status/2"><time>Quoted source</time></a><div data-testid="tweetText">Quoted words</div>
    <a href="../resource">Relative resource</a><img src="/media/photo.png" alt="Photo">
    <a href="javascript:alert(1)">Unsafe script</a><a href="java&#10;script:alert(1)">Obfuscated</a>
    <a href="data:text/html,bad">Unsafe data</a><a href="blob:https://x.com/id">Unsafe blob</a>
    <img src="data:image/png,bad" alt="Fallback"><video src="blob:bad" poster="/media/poster.png"></video>
    </div>`));
  const before = document.body.innerHTML;
  const markdown = serialize(extractPost(document.querySelector('article'), 'https://x.com/alice/status/123'));
  assert.ok(markdown.includes('[Quoted source](https://x.com/bob/status/2)'), markdown);
  assert.ok(markdown.includes('[Relative resource](https://x.com/alice/resource)'), markdown);
  assert.ok(markdown.includes('![Photo](https://x.com/media/photo.png)'), markdown);
  assert.ok(markdown.includes('![Video poster](https://x.com/media/poster.png)'), markdown);
  assert.doesNotMatch(markdown, /javascript:|data:|blob:|java\nscript:/);
  for (const label of ['Unsafe script', 'Obfuscated', 'Unsafe data', 'Unsafe blob', 'Fallback']) assert.ok(markdown.includes(label));
  assert.equal(document.body.innerHTML, before);
});

test('thread follows explicit same-author reply links, deduplicates, and stops at another author', () => {
  const document = dom(`<aside>${tweet('888')}</aside><main data-testid="primaryColumn">
    ${tweet('100')}${tweet('101', 'alice', '', 'data-in-reply-to-status-id="100"')}
    ${tweet('101', 'alice')}${tweet('102', 'ALICE', '', 'data-in-reply-to-status-id="101"')}
    ${tweet('103', 'Bob', '', 'data-in-reply-to-status-id="102"')}
    ${tweet('104', 'Alice', '', 'data-in-reply-to-status-id="102"')}</main>`);
  const selected = document.querySelectorAll('article')[2];
  assert.deepEqual(extractThread(document, selected, 'https://x.com/alice/status/101?x=1').map((post) => post.id), ['100', '101', '102']);
  assert.deepEqual(extractThread(document, selected, 'https://x.com/home'), []);
  assert.deepEqual(extractThread(document, selected, 'https://evil.test/alice/status/101'), []);
});

test('thread does not infer relationships from author proximity or cross recommendation boundaries', () => {
  const document = dom(`<main data-testid="primaryColumn">${tweet('100')}${tweet('101')}
    <h2>Discover more</h2>${tweet('102', 'Alice', '', 'data-in-reply-to-status-id="101"')}</main>`);
  assert.deepEqual(extractThread(document, document.querySelectorAll('article')[1], 'https://x.com/Alice/status/101').map((post) => post.id), ['101']);
  assert.deepEqual(extractThread(dom(tweet('100')), null, 'https://x.com/Alice/status/100'), []);
});

test('S5 native timestamp anchors retain owning post identity and reject quoted identities', () => {
  const native = tweet('123').replace('<a href=', '<a role="link" href=');
  const document = dom(native);
  const before = document.body.innerHTML;
  const record = extractPost(document.querySelector('article'), 'https://x.com/Alice/status/123');
  assert.ok(record);
  assert.equal(record.id, '123');
  assert.equal(record.author, 'Alice');
  assert.equal(record.title, 'Post 123😀');
  assert.equal(document.body.innerHTML, before);
  for (const attrs of ['role="link"', 'data-testid="quoteTweet"', 'data-testid="quotedTweet"', 'data-testid="card.wrapper"']) {
    const missing = dom(`<article data-testid="tweet"><div ${attrs}><a role="link" href="/Alice/status/999"><time>Quoted</time></a><div data-testid="tweetText">Quoted text</div></div></article>`);
    assert.equal(extractPost(missing.querySelector('article'), 'https://x.com/Alice/status/123'), null, attrs);
  }
});

test('S5 Article metadata and content belong to the owner, not same-author embedded previews', () => {
  const document = dom(fs.readFileSync('tests/fixtures/opened-article.html', 'utf8'));
  const owner = document.querySelector('[data-testid="tweet"]');
  const embedded = `<article data-testid="tweet"><a role="link" href="/0xMovez/status/999"><time datetime="2020-01-01T00:00:00Z">Other date</time></a><div data-testid="twitterArticleReadView"><h1>Other title</h1><div data-testid="articleBody">Other preview</div></div><div data-testid="tweetText">Same-author embedded text</div></article>`;
  owner.insertAdjacentHTML('afterbegin', embedded);
  const view = owner.querySelectorAll('[data-testid="twitterArticleReadView"]')[1];
  view.insertAdjacentHTML('afterbegin', `<div data-testid="card.wrapper"><h1>Card title</h1><div data-testid="articleBody">Card preview</div></div>`);
  view.querySelector('[data-testid="twitterArticleRichTextView"]').insertAdjacentHTML('beforeend', embedded);
  const before = document.body.innerHTML;
  const record = extractArticle(owner, 'https://x.com/0xMovez/status/2109604520770548146');
  assert.ok(record);
  assert.deepEqual({ id: record.id, author: record.author, url: record.url, publishedAt: record.publishedAt, title: record.title }, {
    id: '2109604520770548146', author: '0xMovez', url: 'https://x.com/0xMovez/status/2109604520770548146', publishedAt: '2026-10-12T11:18:06.000Z',
    title: 'How to Reverse Engineer Anything with Opus 5.5 ( Full-Course)'
  });
  const markdown = serialize(record);
  assert.equal(markdown.match(/HUbR7_OWkAAMWFZ/g)?.length, 1);
  assert.ok(markdown.indexOf('HUbR7_OWkAAMWFZ') < markdown.indexOf('Most people'));
  assert.equal(markdown.split('Same\\-author embedded text').length - 1, 1);
  assert.equal(markdown.match(/What’s happening/g)?.length, 1);
  assert.match(markdown, /https:\/\/github.com\/morluto\/rea/);
  assert.doesNotMatch(markdown, /profile_images|Copy to clipboard|Download Markdown|Like/);
  assert.equal(document.body.innerHTML, before);
  // Without the owner's timestamp, neither embedded status may supply identity.
  owner.querySelector('a[href="/0xMovez/status/2109604520770548146"]').remove();
  assert.equal(extractArticle(owner, 'https://x.com/0xMovez/status/2109604520770548146'), null);
});

test('S5 Article cannot use embedded-only titles, bodies or publication times', () => {
  const document = dom(`<section data-testid="twitterArticleReadView">${tweet('999', 'Alice', '<h1>Embedded title</h1><div data-testid="articleBody">Embedded preview</div>')}<div data-testid="articleBody"><p>Own body</p></div></section>`);
  const record = extractArticle(document, 'https://x.com/i/article/456');
  assert.equal(record.title, 'X Article');
  assert.equal(record.publishedAt, null);
  assert.equal(record.content.textContent, 'Own body');
  document.querySelector('p').parentElement.remove();
  assert.equal(extractArticle(document, 'https://x.com/i/article/456'), null);
});

test('S5 opened Article extraction accepts the document or owning tweet as root', () => {
  const document = dom(tweet('123', 'Alice', '<div data-testid="twitterArticleReadView"><h1>Own title</h1><div data-testid="articleBody"><p>Own body</p></div></div>'));
  const owner = extractArticle(document.querySelector('article'), 'https://x.com/Alice/status/123');
  const fromDocument = extractArticle(document, 'https://x.com/Alice/status/123');
  assert.ok(fromDocument);
  assert.equal(fromDocument.url, owner.url);
  assert.equal(fromDocument.title, owner.title);
  assert.equal(fromDocument.content.outerHTML, owner.content.outerHTML);
});

test('S5 captured DraftJS emphasis survives on the cloned article body only', () => {
  const document = dom(fs.readFileSync('tests/fixtures/opened-article.html', 'utf8'));
  const before = document.body.innerHTML;
  const record = extractArticle(document.querySelector('article'), 'https://x.com/0xMovez/status/2109604520770548146');
  const markdown = serialize(record);
  assert.match(markdown, /\*\*Medium\*\*/);
  assert.ok(markdown.includes('*01\\. The engine*'), markdown);
  assert.equal(document.body.innerHTML, before);
});

test('S5 native anchors preserve explicitly connected loaded-thread extraction', () => {
  const html = `<main data-testid="primaryColumn">${tweet('100')}${tweet('101', 'Alice', '', 'data-in-reply-to-status-id="100"')}${tweet('999')}</main>`;
  const document = dom(html.replaceAll('<a href=', '<a role="link" href='));
  const before = document.body.innerHTML;
  const records = extractThread(document, document.querySelector('article'), 'https://x.com/Alice/status/100');
  assert.deepEqual(records.map(record => record.id), ['100', '101']);
  assert.equal(document.body.innerHTML, before);
});

test('classic browser script extends the existing namespace without CommonJS', () => {
  const context = { Post2md: { existing: true }, URL };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/extract.js'), 'utf8'), context);
  assert.equal(context.Post2md.existing, true);
  for (const name of ['extractPost', 'extractArticle', 'extractThread']) assert.equal(typeof context.Post2md[name], 'function');
});

test('standalone rich text can be extracted from a document on an article route', () => {
  const document = dom('<h1>Article</h1><div data-testid="twitterArticleRichTextView"><p>Loaded body</p></div>');
  assert.equal(extractArticle(document, 'https://x.com/i/article/456').content.textContent, 'Loaded body');
});

test('title-only longform previews are not loaded article bodies', () => {
  const document = dom('<div data-testid="twitterArticleReadView"><div class="longform-title">Preview title</div></div>');
  assert.equal(extractArticle(document, 'https://x.com/i/article/456'), null);
});

test('article body variants and direct auto title work, including a status read view', () => {
  for (const body of ['data-testid="articleBody"', 'class="longform-body"', 'data-block="true"']) {
    const document = dom(`<div data-testid="twitterArticleReadView"><div dir="auto">Article title</div><div ${body}><p>Full body</p></div></div>`);
    assert.equal(extractArticle(document, 'https://x.com/Alice/article/456').title, 'Article title');
  }
  const document = dom(tweet('123', 'Alice', '<div data-testid="twitterArticleReadView"><h1>Inside status</h1><div data-testid="articleBody"><p>Full article</p></div></div>'));
  assert.equal(extractArticle(document.querySelector('article'), 'https://x.com/Alice/status/123').url, 'https://x.com/Alice/status/123');
  assert.equal(extractArticle(dom('<div data-testid="twitterArticleReadView"><h1>Loading</h1></div>'), 'https://x.com/i/article/456'), null);
});
