/**
 * The assistant's answers as SAFE minimal markdown (F11.14): paragraphs, line breaks, `**bold**`,
 * inline code, `- ` lists and links. The result is a token list the template renders with
 * plain interpolation — no HTML is ever produced or injected. Only relative links into the app
 * (`/app/…`) become links; everything else stays text exactly as written.
 */

/** A link inside the app, split the way `routerLink` wants it. */
export interface AppLink {
  readonly path: string;
  readonly queryParams: Readonly<Record<string, string>> | null;
  readonly fragment: string | null;
}

export type ChatInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly link: AppLink };

export type ChatBlock =
  | { readonly kind: 'paragraph'; readonly lines: readonly ChatInline[][] }
  | { readonly kind: 'list'; readonly items: readonly ChatInline[][] };

const LIST_ITEM = /^\s*[-*]\s+(.*)$/;
// `code` | **bold** | [text](href)
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(([^()\s]+)\)/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\\]/;

export function parseChatMarkdown(source: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let paragraph: ChatInline[][] | null = null;
  let list: ChatInline[][] | null = null;
  const flush = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list) blocks.push({ kind: 'list', items: list });
    paragraph = null;
    list = null;
  };
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (!list) {
        flush();
        list = [];
      }
      list.push(parseInline(item[1] ?? ''));
    } else {
      if (!paragraph) {
        flush();
        paragraph = [];
      }
      paragraph.push(parseInline(line));
    }
  }
  flush();
  return blocks;
}

export function parseInline(text: string): ChatInline[] {
  const tokens: ChatInline[] = [];
  const pushText = (value: string) => {
    if (value === '') return;
    const last = tokens.at(-1);
    if (last?.kind === 'text') {
      tokens[tokens.length - 1] = { kind: 'text', text: last.text + value };
    } else {
      tokens.push({ kind: 'text', text: value });
    }
  };
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    pushText(text.slice(index, match.index));
    index = match.index + match[0].length;
    const [raw, code, bold, label, href] = match;
    if (code !== undefined) {
      tokens.push({ kind: 'code', text: code });
    } else if (bold !== undefined) {
      tokens.push({ kind: 'bold', text: bold });
    } else if (label !== undefined && href !== undefined) {
      const link = appLink(href);
      if (link) tokens.push({ kind: 'link', text: label, link });
      else pushText(raw);
    }
  }
  pushText(text.slice(index));
  return tokens;
}

/** `/app/…` (path, optional `?query` and `#fragment`) as a router link; anything else → null. */
export function appLink(href: string): AppLink | null {
  if (!/^\/app(?:[/?#]|$)/.test(href) || href.includes('//')) return null;
  if (CONTROL.test(href)) return null;
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const fragment = hashAt >= 0 ? decode(href.slice(hashAt + 1)) : null;
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '';
  const segments = path.split('/').map(decode);
  if (segments.some((segment) => segment === null || segment === '..')) {
    return null;
  }
  let queryParams: Record<string, string> | null = null;
  if (query !== '') {
    queryParams = {};
    for (const [key, value] of new URLSearchParams(query)) {
      queryParams[key] = value;
    }
  }
  return {
    path: segments.join('/'),
    queryParams,
    fragment: fragment === '' ? null : fragment,
  };
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
