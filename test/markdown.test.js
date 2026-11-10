import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const md = require('../src/renderer/markdown.js');

describe('markdown.parse', () => {
  it('parses headings, lists, code fences and paragraphs', () => {
    const blocks = md.parse('# Title\n\n- a\n- b\n\n1. one\n2. two\n\n```js\nconst x = 1;\n```\n\nplain **bold** `code`');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'list', 'code', 'paragraph']);
    expect(blocks[1].ordered).toBe(false);
    expect(blocks[2].ordered).toBe(true);
    expect(blocks[3]).toEqual({ type: 'code', lang: 'js', text: 'const x = 1;' });
    expect(blocks[4].children.map((t) => t.type)).toEqual(['text', 'strong', 'text', 'code']);
  });

  it('treats an unterminated fence (mid-stream) as code to the end', () => {
    const blocks = md.parse('```py\nprint(1)\nprint(2');
    expect(blocks).toEqual([{ type: 'code', lang: 'py', text: 'print(1)\nprint(2' }]);
  });

  it('keeps HTML as literal text', () => {
    const [p] = md.parse('<img src=x onerror=alert(1)>');
    expect(p.children).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });

  it('renders links as plain text, never as anchors', () => {
    const tokens = md.parseInline('see [docs](https://evil.example)');
    expect(tokens).toEqual([{ type: 'text', text: 'see ' }, { type: 'text', text: 'docs (https://evil.example)' }]);
  });

  it('does not parse markdown inside inline code', () => {
    expect(md.parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }]);
  });
});
