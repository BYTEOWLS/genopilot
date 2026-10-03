/**
 * Parser for the Markdown subset GenoPilot's documentation uses (see
 * `resources/concepts/done/workflow-documentation.md`). Anything outside the subset is kept as plain
 * text, so no content is lost; `unsupportedMarkdown` reports it for the packaged-docs test.
 */

export type Inline =
  | {kind: 'text'; text: string}
  | {kind: 'code'; text: string; href?: string}
  | {kind: 'bold'; text: string}
  | {kind: 'italic'; text: string}
  | {kind: 'link'; text: string; href: string};

export type AlertVariant = 'note' | 'tip' | 'warning';

export type Block =
  | {kind: 'heading'; level: 1 | 2 | 3; content: Inline[]}
  | {kind: 'paragraph'; content: Inline[]}
  | {kind: 'list'; ordered: boolean; items: Inline[][]}
  | {kind: 'table'; header: Inline[][]; rows: Inline[][][]}
  | {kind: 'code'; text: string}
  | {kind: 'alert'; variant: AlertVariant; paragraphs: Inline[][]};

const headingPattern = /^(#{1,3}) +(.*)$/;
const bulletPattern = /^- +(.*)$/;
const orderedPattern = /^\d+\. +(.*)$/;
const fencePattern = /^```/;
const tableSeparatorPattern = /^\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;
const alertPattern = /^> *\[!(NOTE|TIP|WARNING)\] *$/;

/** Splits a line into inline spans: `code`, **bold**, *italic*, and [links](url) shown as their text. */
export function parseInline(text: string): Inline[] {
  const spans: Inline[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain.length > 0) {
      spans.push({kind: 'text', text: plain});
      plain = '';
    }
  };
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const code = /^`([^`]+)`/.exec(rest);
    const bold = /^\*\*(.+?)\*\*/.exec(rest);
    const italic = /^\*([^*\s][^*]*?)\*/.exec(rest);
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    const match = code ?? bold ?? italic ?? link;
    if (match) {
      flush();
      const inner = match[1] ?? '';
      // A link around inline code, such as a file name, keeps its code style.
      const codeLink = link && /^`[^`]+`$/.test(inner);
      const kind = code || codeLink ? 'code' : bold ? 'bold' : italic ? 'italic' : 'link';
      if (kind === 'link') {
        spans.push({kind, text: inner, href: link?.[2] ?? ''});
      } else {
        spans.push({kind, text: codeLink ? inner.slice(1, -1) : inner, ...(codeLink ? {href: link?.[2]} : {})});
      }
      index += match[0].length;
    } else {
      plain += text[index];
      index += 1;
    }
  }
  flush();
  return spans;
}

/** The plain text of inline spans, without any markup. */
export function inlineText(spans: readonly Inline[]): string {
  return spans.map(span => span.text).join('');
}

function tableCells(line: string): Inline[][] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(cell => parseInline(cell.trim().replaceAll('\\|', '|')));
}

function startsBlock(line: string, next: string | undefined): boolean {
  return headingPattern.test(line) || bulletPattern.test(line) || orderedPattern.test(line) ||
    fencePattern.test(line) || alertPattern.test(line) ||
    (line.startsWith('|') && next !== undefined && tableSeparatorPattern.test(next));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const next = lines[index + 1];
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading) {
      blocks.push({kind: 'heading', level: (heading[1]?.length ?? 1) as 1 | 2 | 3, content: parseInline(heading[2] ?? '')});
      index += 1;
      continue;
    }

    if (fencePattern.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !fencePattern.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({kind: 'code', text: body.join('\n')});
      continue;
    }

    if (line.startsWith('|') && next !== undefined && tableSeparatorPattern.test(next)) {
      const header = tableCells(line);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
        rows.push(tableCells(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({kind: 'table', header, rows});
      continue;
    }

    const alert = alertPattern.exec(line);
    if (alert) {
      const paragraphs: string[][] = [[]];
      index += 1;
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        const text = (lines[index] ?? '').replace(/^> ?/, '');
        if (text.trim().length === 0) {
          paragraphs.push([]);
        } else {
          paragraphs.at(-1)?.push(text.trim());
        }
        index += 1;
      }
      blocks.push({
        kind: 'alert',
        variant: (alert[1] ?? 'NOTE').toLowerCase() as AlertVariant,
        paragraphs: paragraphs.filter(paragraph => paragraph.length > 0).map(paragraph => parseInline(paragraph.join(' '))),
      });
      continue;
    }

    const ordered = orderedPattern.test(line);
    if (ordered || bulletPattern.test(line)) {
      const pattern = ordered ? orderedPattern : bulletPattern;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const item = pattern.exec(current);
        if (item) {
          items.push(item[1] ?? '');
        } else if (current.trim().length > 0 && /^\s/.test(current) && items.length > 0) {
          // An indented line continues the item; nested markers stay part of its text.
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({kind: 'list', ordered, items: items.map(parseInline)});
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim().length > 0 && !startsBlock(lines[index] ?? '', lines[index + 1])) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({kind: 'paragraph', content: parseInline(paragraph.join(' '))});
  }
  return blocks;
}

/** The document's title: the text of its first `#` heading. */
export function documentTitle(blocks: readonly Block[]): string | undefined {
  const title = blocks.find(block => block.kind === 'heading' && block.level === 1);
  return title?.kind === 'heading' ? inlineText(title.content) : undefined;
}

/**
 * Lines outside the supported subset, as `line number: reason`. Such lines still render as plain
 * text; packaged documents must not contain them.
 */
export function unsupportedMarkdown(source: string): string[] {
  const problems: string[] = [];
  let inCode = false;
  let inAlert = false;
  source.replaceAll('\r\n', '\n').split('\n').forEach((line, index) => {
    const at = `${String(index + 1)}: `;
    if (fencePattern.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode) {
      return;
    }
    if (alertPattern.test(line)) {
      inAlert = true;
      return;
    }
    if (line.startsWith('>')) {
      if (!inAlert) {
        problems.push(`${at}blockquote that is not an alert`);
      }
      return;
    }
    inAlert = false;
    if (/^#{4,} /.test(line)) {
      problems.push(`${at}heading deeper than ###`);
    }
    if (/^\s+(-|\d+\.) /.test(line)) {
      problems.push(`${at}nested list`);
    }
    if (/^\s+\S/.test(line)) {
      problems.push(`${at}indented line`);
    }
    if (/!\[[^\]]*\]\(/.test(line)) {
      problems.push(`${at}image`);
    }
    if (/<\/?[a-zA-Z][^>]*>|<!--/.test(line.replace(/`[^`]*`/g, ''))) {
      problems.push(`${at}HTML`);
    }
    if (/\[\^[^\]]+\]/.test(line)) {
      problems.push(`${at}footnote`);
    }
  });
  return problems;
}
