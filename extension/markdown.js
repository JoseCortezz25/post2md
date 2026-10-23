(function (root) {
  'use strict';
  const escape = text => String(text).replace(/\0/g, '\ufffd').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~=\-])/g, '\\$1');
  const blocks = new Set(['DIV', 'P', 'SECTION', 'ARTICLE', 'MAIN', 'FIGURE', 'FIGCAPTION']);

  const clean = text => text.replace(/\n{3,}/g, '\n\n').trim();
  const fence = text => '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));

  function safeURL(value, mail = false, destination = true) {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:', ...(mail ? ['mailto:'] : [])].includes(url.protocol)) return '';
      if (!destination) return url.href;
      return url.href.replace(/[()\[\]<>"'`\\]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase()).replace(/&/g, '&amp;');
    } catch { return ''; }
  }

  function hidden(node) {
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    return style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility)
      || /^(SCRIPT|STYLE|BUTTON|NOSCRIPT|TEMPLATE|INPUT|SELECT|TEXTAREA)$/.test(node.tagName)
      || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
      || node.getAttribute('role') === 'button'
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b/i.test(node.getAttribute('style') || '');
  }

  function semanticTag(node) {
    const aliases = { 'header-one': 'H1', 'header-two': 'H2', 'header-three': 'H3',
      'heading-one': 'H1', 'heading-two': 'H2', 'heading-three': 'H3',
      blockquote: 'BLOCKQUOTE', 'code-block': 'PRE', 'unordered-list': 'UL', 'ordered-list': 'OL', 'list-item': 'LI' };
    const kind = Array.from(node.classList || []).filter(name => name.startsWith('longform-')).map(name => name.slice(9))
      .find(kind => Object.hasOwn(aliases, kind));
    return aliases[kind] || node.tagName;
  }

  function visibleText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || hidden(node)) return '';
    return Array.from(node.childNodes, visibleText).join('');
  }

  function render(node, codeBlocks) {
    if (node.nodeType === 3) {
      // X tweetText preserves literal newlines; ordinary HTML indentation does not.
      if (node.parentElement?.closest('[data-testid="tweetText"]')) {
        return escape(node.nodeValue.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' '))
          .replace(/ *\n */g, '\n').replace(/\n+/g, lines => lines.length === 1 ? '  \n' : '\n\n');
      }
      return escape(node.nodeValue.replace(/\s+/g, ' '));
    }
    if (node.nodeType !== 1 || hidden(node)) return '';
    const tag = semanticTag(node);
    const body = () => Array.from(node.childNodes, child => render(child, codeBlocks)).join('');
    if (tag === 'A') {
      const url = safeURL(node.getAttribute('href'), true);
      return url ? '[' + body() + '](' + url + ')' : body();
    }
    if (tag === 'IMG') {
      const alt = escape(node.getAttribute('alt') || '');
      const url = safeURL(node.getAttribute('src'));
      return url ? '![' + alt + '](' + url + ')' : alt;
    }
    if (['VIDEO', 'AUDIO', 'IFRAME'].includes(tag)) {
      const label = { VIDEO: 'Video', AUDIO: 'Audio', IFRAME: 'Media' }[tag];
      const sources = [node.getAttribute('src'), ...Array.from(node.querySelectorAll('source'), item => item.getAttribute('src'))];
      const refs = sources.map(src => safeURL(src)).filter(Boolean).map(url => `[${label}](${url})`);
      const poster = safeURL(node.getAttribute('poster'));
      if (poster) refs.push(`![Video poster](${poster})`);
      return '\n\n' + refs.join('\n\n') + '\n\n';
    }
    if (tag === 'TABLE') {
      const rows = Array.from(node.querySelectorAll('tr')).filter(row => {
        for (let parent = row; parent !== node; parent = parent.parentElement) {
          if (hidden(parent) || (parent !== row && parent.tagName === 'TABLE')) return false;
        }
        return true;
      }).map(row =>
        Array.from(row.children).filter(cell => !hidden(cell)).map(cell => clean(render(cell, codeBlocks)).replace(/\n+/g, ' ')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length));
      const rowText = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
      return '\n\n' + [rowText(rows[0]), rowText(Array(width).fill('---')), ...rows.slice(1).map(rowText)].join('\n') + '\n\n';
    }
    if (tag === 'PRE') {
      const text = visibleText(node);
      const language = (node.firstElementChild?.getAttribute('class') || '').match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '';
      const marker = fence(text);
      const token = '\0' + codeBlocks.length + '\0';
      codeBlocks.push(marker + language + '\n' + text + (text.endsWith('\n') ? '' : '\n') + marker);
      return '\n\n' + token + '\n\n';
    }
    if (tag === 'CODE') {
      const text = visibleText(node).replace(/\n/g, ' ');
      const marker = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
      return marker + ' ' + text + ' ' + marker;
    }
    if (tag === 'BLOCKQUOTE') return '\n\n' + clean(body()).split('\n').map(line => line ? '> ' + line : '>').join('\n') + '\n\n';
    if (tag === 'UL' || tag === 'OL') {
      let index = Number(node.getAttribute('start')) || 1;
      const items = Array.from(node.children).filter(child => semanticTag(child) === 'LI' && !hidden(child)).map(child => {
        const marker = tag === 'OL' ? `${index++}. ` : '- ';
        return marker + clean(render(child, codeBlocks)).split('\n').join('\n' + ' '.repeat(marker.length));
      });
      return '\n\n' + items.join('\n') + '\n\n';
    }
    if (tag === 'LI') return body().replace(/\n\n(?=[^\n])/g, '\n');
    if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + body().trim() + '\n\n';
    if (tag === 'BR') return '  \n';
    if (tag === 'HR') return '\n\n---\n\n';
    const marks = { STRONG: '**', B: '**', EM: '*', I: '*', DEL: '~~', S: '~~' };
    if (marks[tag]) {
      const text = body();
      return text.replace(/^(\s*)(.*?)(\s*)$/s, (_, before, value, after) =>
        before + (value ? marks[tag] + value + marks[tag] : '') + after);
    }
    if (blocks.has(tag)) return '\n\n' + body().trim() + '\n\n';
    return body();
  }

  function toMarkdown(element) {
    const codeBlocks = [];
    const markdown = clean(render(element, codeBlocks));
    // Restore raw code only after whitespace cleanup, retaining quote/list prefixes.
    return markdown.replace(/\0(\d+)\0/g, (_, index, offset) => {
      const prefix = markdown.slice(markdown.lastIndexOf('\n', offset) + 1, offset)
        .replace(/(?:\d+\. |- )/g, marker => ' '.repeat(marker.length));
      return codeBlocks[index].replace(/\n/g, '\n' + prefix);
    });
  }

  function serialize(record, now = new Date()) {
    const title = String(record.title || 'Untitled');
    const heading = escape(title.replace(/\s+/g, ' ').trim());
    let markdown = typeof record.markdown === 'string' ? record.markdown.trim() : toMarkdown(record.content);
    const first = markdown.match(/^#{1,6} (.*)(?:\n|$)/);
    if (first && [heading, title].includes(first[1])) markdown = markdown.slice(first[0].length).trim();
    const fields = { generated_at: now.toISOString(), title, url: safeURL(record.url, false, false) };
    return '---\n' + Object.entries(fields).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n')
      + '\n---\n\n# ' + heading + (markdown ? '\n\n' + markdown : '') + '\n';
  }

  function filename(title) {
    let stem = String(title || '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
      .trim().replace(/\.md$/i, '').replace(/[. ]+$/g, '');
    if (!stem || /^-+$/.test(stem)) stem = 'x-post';
    if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
    let result = '', bytes = 0;
    for (const char of stem) {
      const point = char.codePointAt(0);
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > 180) break;
      result += char;
    }
    return result.replace(/[. ]+$/g, '') + '.md';
  }

  const api = { toMarkdown, serialize, filename };
  root.Post2md = Object.assign(root.Post2md || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
