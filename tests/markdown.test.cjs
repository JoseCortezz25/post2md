const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const fs = require('node:fs');
const vm = require('node:vm');
const { toMarkdown, serialize, filename } = require('../extension/markdown.js');
const element = html => parseHTML(`<html><body><main>${html}</main></body></html>`).document.querySelector('main');

test('preserves semantic headings, paragraphs, inline formatting and source order', () => {
  assert.equal(toMarkdown(element('<h2>Heading</h2><p>A <strong>bold</strong> <em>word</em> <del>gone</del><br>next</p><hr><p>Again</p><p>Again</p>')),
    '## Heading\n\nA **bold** *word* ~~gone~~  \nnext\n\n---\n\nAgain\n\nAgain');
});

test('tweetText newlines preserve inline boundary spaces and code semantics', () => {
  assert.equal(toMarkdown(element('<div data-testid="tweetText">First<strong> bold </strong>word\nSecond\n\nNext <code>a\nb</code><pre>  raw\n\n\n code</pre></div>')),
    'First **bold** word  \nSecond\n\nNext ` a b `\n\n```\n  raw\n\n\n code\n```');
});

test('keeps nested unordered and ordered lists', () => {
  assert.equal(toMarkdown(element('<ul><li>One<ul><li>Child</li></ul></li><li>Two</li></ul><ol start="3"><li>Three</li></ol>')),
    '- One\n  - Child\n- Two\n\n3. Three');
});

test('prefixes all blockquote paragraphs', () => {
  assert.equal(toMarkdown(element('<blockquote><p>First</p><p>Second</p></blockquote>')), '> First\n>\n> Second');
});

test('preserves code whitespace and chooses fences longer than embedded backticks', () => {
  assert.equal(toMarkdown(element('<pre><code class="language-js">  a\n```\n\n\n b</code></pre><p><code>a`b</code></p>')),
    '````js\n  a\n```\n\n\n b\n````\n\n`` a`b ``');
});

test('exports safe links, images and emoji with destination delimiters encoded', () => {
  assert.equal(toMarkdown(element('<p><a href="https://example.com/a(b)?q=hi there">Link</a> <img src="https://example.com/a.png" alt="A *picture*"> <img src="https://example.com/emoji.png" alt="😀"></p>')),
    '[Link](https://example.com/a%28b%29?q=hi%20there) ![A \\*picture\\*](https://example.com/a.png) ![😀](https://example.com/emoji.png)');
});

test('rejects unsafe URL protocols without discarding readable labels', () => {
  assert.equal(toMarkdown(element('<a href="javascript:alert(1)">bad</a> <img src="data:image/png;base64,xx" alt="fallback"> <a href="mailto:a@example.com">mail</a> <a href="/relative">relative</a>')),
    'bad fallback [mail](mailto:a@example.com) relative');
});

test('escapes untrusted Markdown syntax and literal HTML', () => {
  assert.equal(toMarkdown(element('<p># *x* [y](z) &lt;script&gt; &amp; &#96;code&#96;</p>')),
    '\\# \\*x\\* \\[y\\]\\(z\\) &lt;script&gt; &amp; \\`code\\`');
});

test('omits hidden UI, buttons and executable or styling content', () => {
  assert.equal(toMarkdown(element('<p>Keep</p><script>bad()</script><style>bad</style><button>Share</button><div hidden>Hidden</div><span aria-hidden="true">Hidden</span><div style="display: none">Hidden</div><div style="visibility:hidden">Hidden</div><div role="button">Menu</div><p>End</p>')), 'Keep\n\nEnd');
});

test('renders tables with escaped cells', () => {
  assert.equal(toMarkdown(element('<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A|B</td><td><strong>2</strong></td></tr></tbody></table>')),
    '| Name | Value |\n| --- | --- |\n| A\\|B | **2** |');
});

test('preserves available audio, video and embedded media references', () => {
  assert.equal(toMarkdown(element('<video src="https://example.com/movie.mp4"></video><audio><source src="https://example.com/song.ogg"></audio><iframe src="https://example.com/embed"></iframe>')),
    '[Video](https://example.com/movie.mp4)\n\n[Audio](https://example.com/song.ogg)\n\n[Media](https://example.com/embed)');
});

test('recognizes X longform headings and DraftJS data-block paragraphs without deduplication', () => {
  assert.equal(toMarkdown(element('<div class="longform-header-two">Title</div><div class="longform-paragraph">Same</div><div data-block="true"><div data-offset-key="a"><span>Same</span></div></div><div class="longform-blockquote">Quote</div>')),
    '## Title\n\nSame\n\nSame\n\n> Quote');
});

test('serializes Element records with quoted YAML, UTC date and one title heading', () => {
  assert.equal(serialize({ title: 'A "quote": title', url: 'https://x.com/a/status/1', content: element('<h1>A "quote": title</h1><p>Body</p>') }, new Date('2025-01-02T03:04:05Z')),
    '---\ngenerated_at: "2025-01-02T03:04:05.000Z"\ntitle: "A \\"quote\\": title"\nurl: "https://x.com/a/status/1"\n---\n\n# A "quote": title\n\nBody\n');
});

test('accepts Markdown records, escapes multiline metadata and uses current date by default', () => {
  const result = serialize({ title: 'Line\n# two', url: 'javascript:alert(1)', markdown: 'Body' });
  assert.match(result, /^---\ngenerated_at: "\d{4}-\d\d-\d\dT.*Z"\ntitle: "Line\\n# two"\nurl: ""\n---\n\n# Line \\# two\n\nBody\n$/);
});

test('uses safe portable Unicode filenames, reserved-name protection and a fallback', () => {
  assert.equal(filename('Hello / world: *?'), 'Hello - world- --.md');
  assert.equal(filename(' CON.txt '), '_CON.txt.md');
  assert.equal(filename(' .. '), 'x-post.md');
  assert.equal(filename('日本語 😀'), '日本語 😀.md');
  assert.equal(filename('Title.md'), 'Title.md');
  assert.ok(Buffer.byteLength(filename('😀'.repeat(200))) < 255);
});

test('classic browser script preserves the shared namespace and exposes all three functions', () => {
  const context = vm.createContext({ Post2md: { sentinel: true }, URL });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/markdown.js'), 'utf8'), context);
  assert.equal(context.Post2md.sentinel, true);
  for (const name of ['toMarkdown', 'serialize', 'filename']) assert.equal(typeof context.Post2md[name], 'function');
  assert.equal(context.Post2md.toMarkdown(element('<p>Browser</p>')), 'Browser');
});

test('keeps fenced code inside its enclosing quote or list', () => {
  assert.equal(toMarkdown(element('<blockquote><pre>a\nb</pre></blockquote><ul><li><pre>x\ny</pre></li></ul>')),
    '> ```\n> a\n> b\n> ```\n\n- ```\n  x\n  y\n  ```');
});

test('skips hidden descendants in preformatted blocks and table sections', () => {
  assert.equal(toMarkdown(element('<pre>a<script>bad</script><span hidden>bad</span>b</pre><table><tbody hidden><tr><td>bad</td></tr></tbody><tbody><tr><td>Good</td></tr></tbody></table>')),
    '```\nab\n```\n\n| Good |\n| --- |');
});

test('preserves inline boundary spaces and escapes setext heading markers', () => {
  assert.equal(toMarkdown(element('<p>A<strong> bold </strong>word<br>===</p>')),
    'A **bold** word  \n\\=\\=\\=');
});

test('renders X longform div list items in order', () => {
  assert.equal(toMarkdown(element('<div class="longform-unordered-list"><div class="longform-list-item">One</div><div class="longform-list-item">Two</div></div>')), '- One\n- Two');
});

test('checks obfuscated protocols, media fallback posters and URL syntax characters', () => {
  assert.equal(toMarkdown(element('<a href="java&#10;script:alert(1)">Label</a><video src="blob:invalid" poster="https://example.com/poster.png"></video><a href="https://example.com/a[b]&amp;q=x">Safe</a>')),
    'Label\n\n![Video poster](https://example.com/poster.png)\n\n[Safe](https://example.com/a%5Bb%5D&amp;q=x)');
});
