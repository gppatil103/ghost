// Tiny, safe markdown renderer for model replies. It parses into a plain
// token tree and then builds DOM nodes with createElement/textContent only —
// no innerHTML anywhere — so a reply can never inject markup or scripts.
// Links are deliberately rendered as plain text ("label (url)") so a
// prompt-injected reply can't trick the user into clicking something.
//
// Works both in the renderer (window.ghostMarkdown) and in Node for tests.

(function (root) {
  // ---------- parsing ----------

  function parseInline(text) {
    const tokens = [];
    // order matters: code first so ** inside `code` stays literal
    const re = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) tokens.push({ type: 'text', text: text.slice(last, m.index) });
      if (m[2] !== undefined) tokens.push({ type: 'code', text: m[2] });
      else if (m[3] !== undefined || m[4] !== undefined) tokens.push({ type: 'strong', children: parseInline(m[3] ?? m[4]) });
      else if (m[5] !== undefined || m[6] !== undefined) tokens.push({ type: 'em', children: parseInline(m[5] ?? m[6]) });
      else if (m[7] !== undefined) tokens.push({ type: 'text', text: m[7] === m[8] ? m[8] : `${m[7]} (${m[8]})` });
      last = re.lastIndex;
    }
    if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
    return tokens;
  }

  const FENCE_RE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
  const HEADING_RE = /^(#{1,6})\s+(.*)$/;
  const UL_RE = /^\s*[-*+]\s+(.*)$/;
  const OL_RE = /^\s*(\d+)[.)]\s+(.*)$/;
  const QUOTE_RE = /^\s*>\s?(.*)$/;
  const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;

  function parse(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(FENCE_RE);
      if (fence) {
        const body = [];
        i++;
        // An unterminated fence (mid-stream) runs to the end of the text.
        while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++]);
        i++; // skip closing fence
        blocks.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
        continue;
      }

      if (!line.trim()) { i++; continue; }

      if (HR_RE.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

      const heading = line.match(HEADING_RE);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
        i++;
        continue;
      }

      if (UL_RE.test(line) || OL_RE.test(line)) {
        const ordered = !UL_RE.test(line);
        const re = ordered ? OL_RE : UL_RE;
        const start = ordered ? parseInt(line.match(OL_RE)[1], 10) : 1;
        const items = [];
        while (i < lines.length && re.test(lines[i])) {
          const m = lines[i].match(re);
          items.push(parseInline(ordered ? m[2] : m[1]));
          i++;
        }
        blocks.push({ type: 'list', ordered, start, items });
        continue;
      }

      if (QUOTE_RE.test(line)) {
        const body = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].match(QUOTE_RE)[1]);
        blocks.push({ type: 'quote', children: parseInline(body.join('\n')) });
        continue;
      }

      const para = [];
      while (
        i < lines.length && lines[i].trim() &&
        !FENCE_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) &&
        !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) && !QUOTE_RE.test(lines[i]) && !HR_RE.test(lines[i])
      ) para.push(lines[i++]);
      blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
    }
    return blocks;
  }

  // ---------- rendering ----------

  function renderInline(doc, parent, tokens) {
    for (const t of tokens) {
      if (t.type === 'text') parent.appendChild(doc.createTextNode(t.text));
      else if (t.type === 'code') {
        const el = doc.createElement('code');
        el.textContent = t.text;
        parent.appendChild(el);
      } else {
        const el = doc.createElement(t.type === 'strong' ? 'strong' : 'em');
        renderInline(doc, el, t.children);
        parent.appendChild(el);
      }
    }
  }

  function renderCode(doc, block, onCopy) {
    const wrap = doc.createElement('div');
    wrap.className = 'code-block';
    const bar = doc.createElement('div');
    bar.className = 'code-bar';
    const lang = doc.createElement('span');
    lang.textContent = block.lang || 'code';
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-btn';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => onCopy && onCopy(block.text, copy));
    bar.append(lang, copy);
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.textContent = block.text;
    pre.appendChild(code);
    wrap.append(bar, pre);
    return wrap;
  }

  function render(doc, blocks, { onCopy } = {}) {
    const frag = doc.createDocumentFragment();
    for (const b of blocks) {
      let el;
      if (b.type === 'code') el = renderCode(doc, b, onCopy);
      else if (b.type === 'hr') el = doc.createElement('hr');
      else if (b.type === 'heading') {
        el = doc.createElement(`h${Math.min(6, b.level + 2)}`); // keep headings small in the panel
        renderInline(doc, el, b.children);
      } else if (b.type === 'list') {
        el = doc.createElement(b.ordered ? 'ol' : 'ul');
        if (b.ordered && b.start !== 1) el.setAttribute('start', String(b.start));
        for (const item of b.items) {
          const li = doc.createElement('li');
          renderInline(doc, li, item);
          el.appendChild(li);
        }
      } else if (b.type === 'quote') {
        el = doc.createElement('blockquote');
        renderInline(doc, el, b.children);
      } else {
        el = doc.createElement('p');
        renderInline(doc, el, b.children);
      }
      frag.appendChild(el);
    }
    return frag;
  }

  const api = { parse, parseInline, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ghostMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
