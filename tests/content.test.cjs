'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const post = (id = '10', text = 'Hello world', parent = '') => `<article data-testid="tweet" ${parent ? `data-in-reply-to-status-id="${parent}"` : ''}><a href="/alice/status/${id}"><time datetime="2026-01-01T12:00:00Z">Date</time></a><div data-testid="tweetText">${text}</div><div role="group"><button>Reply</button></div></article>`;
const article = '<section data-testid="twitterArticleReadView"><h1>Rich article</h1><div data-testid="articleBody"><h2>Details</h2><p>Long content <strong>bold</strong></p><ul><li>First</li></ul><img src="https://example.com/photo.png" alt="Photo"><pre><code>let x = 1;</code></pre></div></section>';
function browser(html = post(), path = '/alice/status/10') {
  const { window } = parseHTML(`<html><body><main data-testid="primaryColumn">${html}</main></body></html>`);
  const downloads = [], blobs = [], revoked = [], timers = [];
  const location = { href: `https://x.com${path}` };
  const URLStub = class extends URL {};
  URLStub.createObjectURL = blob => { blobs.push(blob); return 'blob:test'; };
  URLStub.revokeObjectURL = url => revoked.push(url);
  const context = vm.createContext({ document: window.document, location, URL: URLStub, Blob,
    MutationObserver: window.MutationObserver, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {} });
  window.document.addEventListener('click', event => {
    if (event.target.matches('a[download]')) { downloads.push({ filename: event.target.getAttribute('download'), href: event.target.href }); event.preventDefault(); }
  });
  for (const name of ['markdown', 'extract', 'content']) vm.runInContext(fs.readFileSync(`extension/${name}.js`, 'utf8'), context);
  return { document: window.document, window, downloads, blobs, revoked, location, URLStub,
    async flush() { await new Promise(resolve => setImmediate(resolve)); const pending = timers.splice(0); for (const timer of pending) if (timer.delay < 1000) timer.fn(); else timers.push(timer); await new Promise(resolve => setImmediate(resolve)); },
    cleanup() { for (const timer of timers.splice(0)) timer.fn(); } };
}
function click(b, button) {
  const event = new b.window.Event('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'click must not navigate the X card');
}
const buttons = b => [...b.document.querySelectorAll('button[data-post2md]')];

test('post button requests a Markdown download and delays URL cleanup', async () => {
  const b = browser();
  assert.equal(buttons(b).length, 1, 'one automatic download button per post');
  const button = buttons(b).find(node => node.textContent === 'Download Markdown');
  assert.ok(button);
  assert.equal(button.parentElement.getAttribute('role'), 'group');
  assert.equal(button.closest('a'), null);
  click(b, button);
  assert.equal(b.blobs.length, 1);
  assert.equal(b.blobs[0].type, 'text/markdown;charset=utf-8');
  assert.match(await b.blobs[0].text(), /generated_at: ".*Z"/);
  assert.match(await b.blobs[0].text(), /url: "https:\/\/x.com\/alice\/status\/10"/);
  assert.match(await b.blobs[0].text(), /Hello world/);
  assert.equal(b.downloads[0].filename, 'Hello world.md');
  assert.equal(b.document.querySelector('a[download]'), null);
  assert.deepEqual(b.revoked, []);
  assert.match(b.document.querySelector('[role="status"]').textContent, /requested/i);
  b.cleanup();
  assert.deepEqual(b.revoked, ['blob:test']);
});

test('download preserves literal tweetText line breaks and blank paragraphs', async () => {
  const b = browser();
  b.document.querySelector('[data-testid="tweetText"]').textContent = 'First line\nSecond line\n\nNext paragraph';
  click(b, buttons(b).find(node => node.textContent === 'Download Markdown'));
  const markdown = await b.blobs[0].text();
  assert.ok(markdown.endsWith('First line  \nSecond line\n\nNext paragraph\n'), markdown);
  b.cleanup();
});

test('loaded thread exports connected records with source metadata, not unrelated posts', async () => {
  const b = browser(post() + post('11', 'Second post', '10') + post('99', 'Unrelated'));
  assert.equal(buttons(b).length, 3, 'one button per loaded post, no separate thread action');
  click(b, buttons(b).find(node => node.textContent === 'Download Markdown'));
  assert.equal(b.downloads.length, 1);
  const text = await b.blobs[0].text();
  assert.match(text, /title: "Hello world/);
  assert.match(text, /Loaded subset/);
  assert.match(text, /https:\/\/x.com\/alice\/status\/11/);
  assert.match(text, /Author: @alice/);
  assert.ok(text.includes('2026\\-01\\-01T12:00:00Z'));
  assert.doesNotMatch(text, /Unrelated/);
  assert.equal(buttons(b).filter(node => /thread/.test(node.textContent)).length, 0);
  b.cleanup();
});

test('automatic download falls back to a post and detects a thread loaded later', async () => {
  const b = browser();
  assert.equal(buttons(b).length, 1);
  const button = buttons(b)[0];
  click(b, button);
  assert.equal(b.blobs.length, 1);
  assert.equal(b.downloads.length, 1);
  assert.doesNotMatch(await b.blobs[0].text(), /Loaded subset/);
  b.document.querySelector('main').insertAdjacentHTML('beforeend', post('11', 'Loaded later', '10'));
  await b.flush();
  assert.equal(buttons(b).length, 2);
  click(b, button);
  assert.equal(b.blobs.length, 2);
  assert.equal(b.downloads.length, 2);
  assert.match(await b.blobs[1].text(), /Loaded subset/);
  assert.match(await b.blobs[1].text(), /Loaded later/);
  b.cleanup();
});

test('observer handles new posts and recycled identities without duplicates', async () => {
  const b = browser();
  const tweet = b.document.querySelector('[data-testid="tweet"]');
  const button = buttons(b).find(node => node.textContent === 'Download Markdown');
  tweet.querySelector('a').setAttribute('href', '/alice/status/20');
  tweet.querySelector('[data-testid="tweetText"]').textContent = 'Recycled content';
  b.location.href = 'https://x.com/home';
  b.document.querySelector('main').insertAdjacentHTML('beforeend', post('30', 'New post'));
  await b.flush(); await b.flush();
  assert.equal(buttons(b).length, 2);
  click(b, button);
  const text = await b.blobs[0].text();
  assert.match(text, /Recycled content/);
  assert.match(text, /status\/20/);
  assert.doesNotMatch(text, /Hello world/);
  await b.flush(); await b.flush();
  assert.equal(buttons(b).length, 2);
});

test('full standalone article exports rich content and removes stale SPA controls', async () => {
  const b = browser(article, '/i/article/42');
  assert.equal(buttons(b).length, 1);
  click(b, buttons(b)[0]);
  const text = await b.blobs[0].text();
  assert.match(text, /title: "Rich article"/);
  assert.match(text, /## Details/);
  assert.match(text, /\*\*bold\*\*/);
  assert.match(text, /!\[Photo\]\(https:\/\/example.com\/photo.png\)/);
  assert.match(text, /```\nlet x = 1;/);
  b.location.href = 'https://x.com/home';
  b.document.querySelector('h1').textContent = 'Navigated';
  await b.flush();
  assert.equal(buttons(b).length, 0);
});

test('article body wrapper works without a read view and previews do not get controls', () => {
  const b = browser('<div data-testid="articleBody"><p>Full body</p></div>', '/i/article/42');
  assert.equal(buttons(b).length, 1);
  const preview = browser('<div data-testid="card.wrapper"><h1>Preview only</h1></div>', '/i/article/42');
  assert.equal(buttons(preview).length, 0);
});

test('extraction and download failures are local, clean up and allow retries', () => {
  const b = browser();
  const button = buttons(b).find(node => node.textContent === 'Download Markdown');
  const time = b.document.querySelector('time');
  time.parentElement.setAttribute('href', '/not-a-post');
  click(b, button);
  assert.equal(b.blobs.length, 0);
  assert.match(b.document.querySelector('[role="status"]').textContent, /Could not.*retry/);
  time.parentElement.setAttribute('href', '/alice/status/10');
  const create = b.URLStub.createObjectURL;
  b.URLStub.createObjectURL = () => { throw new Error('Browser download unavailable'); };
  click(b, button);
  assert.match(b.document.querySelector('[role="status"]').textContent, /Browser download unavailable/);
  b.URLStub.createObjectURL = create;
  click(b, button);
  assert.equal(b.downloads.length, 1);
  assert.equal(b.document.querySelectorAll('[role="status"]').length, 1);
  assert.equal(b.document.querySelector('a[download]'), null);
});

test('quoted and nested interactive action areas never receive controls', () => {
  const b = browser(`<div role="link">${post('40', 'Quoted')}</div><a href="/alice/status/50">${post('50', 'Nested')}</a>`);
  assert.equal(buttons(b).length, 0);
});

test('automatic download prioritizes an opened Article over its connected thread', async () => {
  const b = browser(post().replace('<div role="group">', `${article}<div role="group">`) + post('11', 'Thread reply', '10'));
  assert.equal(buttons(b).length, 2);
  click(b, buttons(b)[0]);
  assert.equal(b.blobs.length, 1);
  assert.equal(b.downloads.length, 1);
  const text = await b.blobs[0].text();
  assert.match(text, /title: "Rich article"/);
  assert.match(text, /Long content/);
  assert.doesNotMatch(text, /Thread reply|Loaded subset/);
  b.cleanup();
});

test('S5 supplied opened Article downloads owning Markdown through its DOM button', async () => {
  const html = fs.readFileSync('tests/fixtures/opened-article.html', 'utf8');
  const b = browser(html, '/0xMovez/status/2109604520770548146');
  const view = b.document.querySelector('[data-testid="twitterArticleReadView"]');
  const button = [...view.querySelectorAll('button[data-post2md]')].find(node =>
    node.textContent === 'Download Markdown' && node.closest('[data-testid="tweet"]') === view.parentElement);
  assert.ok(button, 'the opened Article must receive a live download control');
  click(b, button);
  const status = b.document.querySelector('[role="status"]')?.textContent;
  assert.equal(b.blobs.length, 1, status);
  assert.equal(b.downloads.length, 1, status);
  const text = await b.blobs[0].text();
  assert.match(text, /title: "How to Reverse Engineer Anything with Opus 5\.5 \( Full-Course\)"/);
  assert.match(text, /url: "https:\/\/x\.com\/0xMovez\/status\/2109604520770548146"/);
  assert.ok(text.includes('Author: @0xMovez'), text);
  assert.ok(text.includes('2026\\-10\\-12T11:18:06\\.000Z'), text);
  assert.match(text, /Most people who try to reverse/);
  assert.ok(text.includes('01\\. The engine'), text);
  assert.match(text, /HUbR7_OWkAAMWFZ/);
  assert.match(text, /HUbACe1WcAARFGi/);
  assert.match(text, /movez\.substack\.com/);
  assert.match(text, /npx rea-agents setup/);
  assert.match(text, /\*\*Medium/);
  assert.match(text, /\[Source\]\(https:\/\/x.com\/0xMovez\/status\/2109604520770548146\)/);
  assert.equal(text.match(/HUbR7_OWkAAMWFZ/g)?.length, 1);
  assert.ok(text.indexOf('HUbR7_OWkAAMWFZ') < text.indexOf('Most people'));
  assert.ok(text.indexOf('Most people') < text.indexOf('HUbACe1WcAARFGi'));
  assert.equal(text.match(/What’s happening/g)?.length, 1);
  assert.doesNotMatch(text, /profile_images|Copy to clipboard|Download Markdown|Like/);
  assert.equal(status, 'Markdown download requested. Check your browser downloads.');
  b.cleanup();
});

test('S5 native timestamp anchors select the owning loaded thread without quote controls', async () => {
  const native = html => html.replaceAll('<a href=', '<a role="link" href=');
  const b = browser(native(post() + post('11', 'Second post', '10') + post('99', 'Unrelated')));
  assert.equal(buttons(b).length, 3);
  const button = buttons(b).find(node => node.textContent === 'Download Markdown');
  click(b, button);
  assert.equal(b.blobs.length, 1);
  assert.equal(b.downloads.length, 1);
  const text = await b.blobs[0].text();
  assert.match(text, /Hello world/);
  assert.match(text, /Second post/);
  assert.doesNotMatch(text, /Unrelated/);
  b.cleanup();
  for (const attrs of ['role="link"', 'data-testid="quoteTweet"', 'data-testid="quotedTweet"', 'data-testid="card.wrapper"']) {
    const quoted = browser(`<article data-testid="tweet"><div ${attrs}><a role="link" href="/alice/status/10"><time>Quoted date</time></a></div><div data-testid="tweetText">No owning timestamp</div><div role="group"></div></article>`);
    assert.equal(buttons(quoted).filter(node => node.textContent === 'Download loaded thread').length, 0, attrs);
    const button = buttons(quoted).find(node => node.textContent === 'Download Markdown');
    assert.ok(button);
    click(quoted, button);
    assert.equal(quoted.blobs.length, 0, attrs);
    assert.match(quoted.document.querySelector('[role="status"]').textContent, /No supported loaded content/);
    quoted.cleanup();
  }
});

test('manifest credits Alfonso Chavarro as the extension author', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.author, 'Alfonso Chavarro');
});

test('manifest is least privilege and loads classic scripts in contract order', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  for (const key of ['permissions', 'host_permissions', 'background', 'action']) assert.equal(manifest[key], undefined);
  assert.equal(manifest.content_scripts.length, 1);
  const script = manifest.content_scripts[0];
  assert.deepEqual(script.js, ['markdown.js', 'extract.js', 'content.js']);
  assert.ok(!script.world || script.world === 'ISOLATED');
  assert.deepEqual([...script.matches].sort(), ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].map(host => `https://${host}/*`).sort());
  for (const path of [...script.js, ...script.css]) assert.ok(fs.existsSync(`extension/${path}`));
});
