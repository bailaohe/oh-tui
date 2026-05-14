/**
 * markdown — lenient subset tokenizer for assistant output.
 *
 * Supported block tokens:
 *   - heading (#, ##, ###)
 *   - paragraph
 *   - list_item (-, *, +, "1.")
 *   - code_block (``` fenced, optional lang)
 *
 * Supported inline tokens:
 *   - text (plain)
 *   - bold (**x**)
 *   - italic (*x*)
 *   - code (`x`)
 *   - link ([text](url))
 *
 * Anything outside this subset falls back to plain text. The parser is
 * intentionally lenient so partial / streaming markdown never throws.
 */

export type Token =
  | { type: "heading"; level: 1 | 2 | 3; text: InlineToken[] }
  | { type: "paragraph"; text: InlineToken[] }
  | { type: "list_item"; marker: string; text: InlineToken[] }
  | { type: "code_block"; lang: string | null; code: string };

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const lines = input.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    const fenceMatch = /^```(\w*)?\s*$/.exec(line);
    if (fenceMatch !== null) {
      const lang =
        fenceMatch[1] !== undefined && fenceMatch[1].length > 0
          ? fenceMatch[1]
          : null;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({ type: "code_block", lang, code: codeLines.join("\n") });
      if (i < lines.length) i += 1; // skip closing fence
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch !== null) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      out.push({
        type: "heading",
        level,
        text: tokenizeInline(headingMatch[2]!),
      });
      i += 1;
      continue;
    }

    // List item
    const listMatch = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch !== null) {
      out.push({
        type: "list_item",
        marker: listMatch[1]!,
        text: tokenizeInline(listMatch[2]!),
      });
      i += 1;
      continue;
    }

    // Blank line → skip
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph (collect until blank/heading/list/fence)
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!) &&
      !/^```/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i += 1;
    }
    out.push({ type: "paragraph", text: tokenizeInline(buf.join(" ")) });
  }
  return out;
}

export function tokenizeInline(s: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  while (i < s.length) {
    // Inline code
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        tokens.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Bold **x**
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end > i) {
        tokens.push({ type: "bold", text: s.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Italic *x*
    if (s[i] === "*" && s[i + 1] !== "*") {
      const end = s.indexOf("*", i + 1);
      if (end > i + 1) {
        tokens.push({ type: "italic", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Link [text](url)
    if (s[i] === "[") {
      const closeBracket = s.indexOf("]", i + 1);
      if (closeBracket > i && s[closeBracket + 1] === "(") {
        const closeParen = s.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          tokens.push({
            type: "link",
            text: s.slice(i + 1, closeBracket),
            href: s.slice(closeBracket + 2, closeParen),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Plain text up to next special char or end
    const next = nextSpecial(s, i);
    if (next === i) {
      // Defensive: ensure forward progress on stray special chars.
      tokens.push({ type: "text", text: s[i]! });
      i += 1;
      continue;
    }
    tokens.push({ type: "text", text: s.slice(i, next) });
    i = next;
  }
  return tokens;
}

function nextSpecial(s: string, start: number): number {
  for (let j = start + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "`" || c === "*" || c === "[") return j;
  }
  return s.length;
}
