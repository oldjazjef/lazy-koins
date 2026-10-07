import { appLink, parseChatMarkdown, parseInline } from './chat-markdown';

describe('parseChatMarkdown', () => {
  it('splits paragraphs, line breaks and lists', () => {
    const blocks = parseChatMarkdown(
      'Erste Zeile\nzweite Zeile\n\n- eins\n* zwei\nDanach',
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ kind: 'text', text: 'Erste Zeile' }],
          [{ kind: 'text', text: 'zweite Zeile' }],
        ],
      },
      {
        kind: 'list',
        items: [
          [{ kind: 'text', text: 'eins' }],
          [{ kind: 'text', text: 'zwei' }],
        ],
      },
      { kind: 'paragraph', lines: [[{ kind: 'text', text: 'Danach' }]] },
    ]);
  });

  it('reads bold, inline code and app links', () => {
    expect(
      parseInline(
        'Vermögen **CHF 1’234** in `list_positions`, siehe [Ergebnis](/app/projects/p1?tab=result&figure=pos%3AKraken%7Cmain%7CBTC).',
      ),
    ).toEqual([
      { kind: 'text', text: 'Vermögen ' },
      { kind: 'bold', text: 'CHF 1’234' },
      { kind: 'text', text: ' in ' },
      { kind: 'code', text: 'list_positions' },
      { kind: 'text', text: ', siehe ' },
      {
        kind: 'link',
        text: 'Ergebnis',
        link: {
          path: '/app/projects/p1',
          queryParams: { tab: 'result', figure: 'pos:Kraken|main|BTC' },
          fragment: null,
        },
      },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps a fragment for the files tab', () => {
    expect(appLink('/app/projects/p1?tab=files#file-f9')).toEqual({
      path: '/app/projects/p1',
      queryParams: { tab: 'files' },
      fragment: 'file-f9',
    });
  });

  it('turns only relative /app/ links into links', () => {
    for (const href of [
      'https://evil.example/app/x',
      '//evil.example/app',
      'javascript:alert(1)',
      '/api/projects',
      '/application',
      '/app/../login',
      '/app//evil.example',
    ]) {
      expect(appLink(href)).toBeNull();
      expect(parseInline(`[klick](${href})`)).toEqual([
        { kind: 'text', text: `[klick](${href})` },
      ]);
    }
  });

  it('never produces HTML: tags stay text', () => {
    const tokens = parseInline(
      '<img src=x onerror="alert(1)"> **<b>fett</b>** [<script>](/app/x)',
    );
    expect(tokens.every((token) => typeof token.text === 'string')).toBe(true);
    expect(tokens[0]).toEqual({
      kind: 'text',
      text: '<img src=x onerror="alert(1)"> ',
    });
    expect(tokens[1]).toEqual({ kind: 'bold', text: '<b>fett</b>' });
    expect(tokens.at(-1)).toMatchObject({ kind: 'link', text: '<script>' });
  });
});
