const DASH_OR_EQUALS_LINE = /^(\s*)(-+|=+)[ \t\u00a0]*$/;

/**
 * Stop a line of '-' or '=' from turning the line above into a heading.
 *
 * Markdown reads 'two\n-' as a level-2 heading "two" (a setext heading). In a
 * note that is never what was meant: it happens when a new list row holds only
 * its dash (Tab on an empty bullet gives '- two\n  - ') or when a dash is typed
 * under a line. Headings come from '#'. So, after a non-blank line:
 * - a lone '-' is an empty list row, as typed;
 * - '---' or longer is a horizontal rule;
 * - '--', '=' and other short runs are plain text.
 * Code fences are left alone. Source is not mutated: this runs on the copy
 * handed to marked.
 */
export function neutralizeSetextHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || i === 0 || /^\s*$/.test(lines[i - 1])) continue;
    const match = line.match(DASH_OR_EQUALS_LINE);
    if (!match) continue;
    const [, indent, run] = match;
    if (run === '-') lines[i] = `${indent}- \u200b`;
    else if (run[0] === '-' && run.length >= 3) lines[i] = `\n${line}`;
    else lines[i] = `${indent}\\${run}`;
  }
  return lines.join('\n');
}
