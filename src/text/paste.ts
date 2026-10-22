/**
 * Pasted plain text (REQ-TEXT-070): text that carries markdown structure
 * (headings, list rows, quotes, fences, tables, links, closed bold/code) is
 * pasted formatted; anything else pastes as typed, so `2*3*4` or `costs $5`
 * never turn into formatting.
 */

const BLOCK = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>\s?\S|```|~~~|\|.*\|\s*$|(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const INLINE = /\*\*\S(?:.*?\S)?\*\*|__\S(?:.*?\S)?__|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`|~~\S(?:.*?\S)?~~|!\[[^\]]*\]\(/;

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.some((line) => BLOCK.test(line)) || INLINE.test(text);
}
