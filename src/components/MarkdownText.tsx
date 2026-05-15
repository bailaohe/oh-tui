/**
 * MarkdownText — render a markdown subset to Ink primitives.
 *
 * Built on `marked`'s lexer for full GFM coverage (headings, paragraphs,
 * lists, code blocks, blockquotes, tables, hr, inline bold/italic/code/link).
 * The render layer is 1:1 with OpenHarness's terminal frontend so the visual
 * is consistent across the two projects.
 *
 * When `cursor` is true, a trailing ▍ glyph renders to signal an in-flight
 * streaming response. Wrapped in React.memo so identical `source` doesn't
 * re-lex on parent re-render.
 */

import type React from "react";
import { Fragment, memo, useMemo } from "react";
import { Box, Text } from "ink";
import { lexer, type Token, type Tokens } from "marked";
import stringWidth from "string-width";

import { useTheme } from "../theme/ThemeContext.js";
import type { ThemeConfig } from "../theme/builtinThemes.js";

export interface MarkdownTextProps {
  source: string;
  /** Show a trailing cursor (▍) — used during active streaming. */
  cursor?: boolean;
}

function getInlineFallbackText(token: Token): string {
  if ("text" in token && typeof token.text === "string") {
    return token.text;
  }
  return token.raw;
}

function getInlineDisplayText(tokens: Token[] | undefined): string {
  if (tokens === undefined || tokens.length === 0) return "";
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text": {
          const t = token as Tokens.Text;
          return t.tokens !== undefined && t.tokens.length > 0
            ? getInlineDisplayText(t.tokens)
            : t.text;
        }
        case "strong":
        case "em":
        case "del":
          return getInlineDisplayText(
            (token as Tokens.Strong | Tokens.Em | Tokens.Del).tokens,
          );
        case "codespan":
          return (token as Tokens.Codespan).text;
        case "link": {
          const l = token as Tokens.Link;
          return l.text.length > 0 ? l.text : l.href;
        }
        case "image": {
          const image = token as Tokens.Image;
          return image.text.length > 0 ? image.text : image.href;
        }
        case "br":
          return "\n";
        case "escape":
          return (token as Tokens.Escape).text;
        default:
          return getInlineFallbackText(token);
      }
    })
    .join("");
}

function getTableCellDisplayText(cell: Tokens.TableCell): string {
  const display = getInlineDisplayText(cell.tokens);
  return display.length > 0 ? display : cell.text;
}

function renderInline(
  tokens: Token[] | undefined,
  theme: ThemeConfig,
): React.ReactNode {
  if (tokens === undefined || tokens.length === 0) return null;
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens !== undefined && t.tokens.length > 0) {
          return (
            <Fragment key={i}>{renderInline(t.tokens, theme)}</Fragment>
          );
        }
        return <Text key={i}>{t.text}</Text>;
      }
      case "strong": {
        const s = token as Tokens.Strong;
        return (
          <Text key={i} bold>
            {renderInline(s.tokens, theme)}
          </Text>
        );
      }
      case "em": {
        const e = token as Tokens.Em;
        return (
          <Text key={i} italic>
            {renderInline(e.tokens, theme)}
          </Text>
        );
      }
      case "del": {
        const d = token as Tokens.Del;
        return (
          <Text key={i} strikethrough>
            {renderInline(d.tokens, theme)}
          </Text>
        );
      }
      case "codespan": {
        const c = token as Tokens.Codespan;
        return (
          <Text key={i} color={theme.colors.accent}>
            {c.text}
          </Text>
        );
      }
      case "link": {
        const l = token as Tokens.Link;
        const label = l.text.length > 0 ? l.text : l.href;
        return (
          <Text key={i} color={theme.colors.info}>
            {label}
          </Text>
        );
      }
      case "image": {
        const image = token as Tokens.Image;
        return (
          <Text key={i}>
            {image.text.length > 0 ? image.text : image.href}
          </Text>
        );
      }
      case "br":
        return <Text key={i}>{"\n"}</Text>;
      case "escape": {
        const es = token as Tokens.Escape;
        return <Text key={i}>{es.text}</Text>;
      }
      default:
        return <Text key={i}>{getInlineFallbackText(token)}</Text>;
    }
  });
}

function renderBlocks(
  tokens: Token[] | undefined,
  theme: ThemeConfig,
): React.ReactNode {
  if (tokens === undefined || tokens.length === 0) return null;
  return tokens.map((token, i) => (
    <MarkdownBlock key={i} token={token} theme={theme} />
  ));
}

function MarkdownBlock({
  token,
  theme,
}: {
  token: Token;
  theme: ThemeConfig;
}): React.JSX.Element | null {
  switch (token.type) {
    case "heading": {
      const h = token as Tokens.Heading;
      const headingColors: string[] = [
        theme.colors.primary,
        theme.colors.secondary,
        theme.colors.accent,
        theme.colors.info,
        theme.colors.muted,
        theme.colors.muted,
      ];
      const color = headingColors[h.depth - 1] ?? theme.colors.primary;
      const isMajor = h.depth <= 2;
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color={color} bold={isMajor} underline={h.depth === 1}>
            {renderInline(h.tokens, theme)}
          </Text>
          {h.depth === 1 ? (
            <Text color={color} dimColor>
              {"━".repeat(32)}
            </Text>
          ) : null}
        </Box>
      );
    }

    case "paragraph": {
      const p = token as Tokens.Paragraph;
      return (
        <Box marginTop={0} flexWrap="wrap">
          <Text>{renderInline(p.tokens, theme)}</Text>
        </Box>
      );
    }

    case "code": {
      // hermes-style: no border, just indented + accent-colored, with a
      // dimmed `— lang` separator above when a language is declared.
      const c = token as Tokens.Code;
      const lines = c.text.split("\n");
      return (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {typeof c.lang === "string" && c.lang.length > 0 ? (
            <Text dimColor>{`— ${c.lang}`}</Text>
          ) : null}
          {lines.map((line, i) => (
            <Text key={i} color={theme.colors.accent}>
              {line}
            </Text>
          ))}
        </Box>
      );
    }

    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      return (
        <Box flexDirection="column" marginTop={0} marginLeft={0}>
          {bq.tokens.map((t, i) => (
            <Box key={i} flexDirection="row">
              <Text color={theme.colors.muted}>{"│ "}</Text>
              <Box flexDirection="column" flexGrow={1}>
                {renderBlocks([t], theme)}
              </Box>
            </Box>
          ))}
        </Box>
      );
    }

    case "list": {
      const l = token as Tokens.List;
      return (
        <Box flexDirection="column" marginTop={0} marginLeft={2}>
          {l.items.map((item, i) => {
            const inlineTokens: Token[] = item.tokens.flatMap((t) =>
              "tokens" in t && t.tokens !== undefined
                ? (t.tokens as Token[])
                : [],
            );
            const bullet = l.ordered
              ? `${(Number(l.start) || 1) + i}. `
              : "• ";
            return (
              <Box key={i} flexDirection="row">
                <Text color={theme.colors.primary}>{bullet}</Text>
                <Box flexGrow={1}>
                  <Text>
                    {inlineTokens.length > 0
                      ? renderInline(inlineTokens, theme)
                      : item.text}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }

    case "hr":
      return (
        <Box marginTop={1}>
          <Text dimColor>{"─".repeat(48)}</Text>
        </Box>
      );

    case "space":
      return null;

    case "table": {
      // hermes-style: no outer box, per-column underline beneath header,
      // 2-space gap between cols, bold-colored header cells.
      const t = token as Tokens.Table;
      const headerTexts = t.header.map(getTableCellDisplayText);
      const rowTexts = t.rows.map((row) => row.map(getTableCellDisplayText));
      const colCount = t.header.length;
      const colWidths: number[] = headerTexts.map((cellText) =>
        stringWidth(cellText),
      );
      for (const row of rowTexts) {
        for (let c = 0; c < colCount; c++) {
          colWidths[c] = Math.max(colWidths[c] ?? 0, stringWidth(row[c] ?? ""));
        }
      }
      const trailing = (cellText: string, c: number): string =>
        " ".repeat(Math.max(0, (colWidths[c] ?? 0) - stringWidth(cellText)));
      const GAP = "  ";
      return (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text>
            {t.header.map((cell, c) => (
              <Fragment key={c}>
                <Text color={theme.colors.primary} bold>
                  {renderInline(cell.tokens, theme)}
                  {trailing(headerTexts[c] ?? "", c)}
                </Text>
                {c < colCount - 1 ? <Text>{GAP}</Text> : null}
              </Fragment>
            ))}
          </Text>
          <Text>
            {colWidths.map((w, c) => (
              <Fragment key={c}>
                <Text color={theme.colors.primary} dimColor>
                  {"─".repeat(w)}
                </Text>
                {c < colCount - 1 ? <Text>{GAP}</Text> : null}
              </Fragment>
            ))}
          </Text>
          {t.rows.map((row, i) => (
            <Text key={i}>
              {row.map((cell, c) => (
                <Fragment key={c}>
                  <Text>
                    {renderInline(cell.tokens, theme)}
                    {trailing(rowTexts[i]?.[c] ?? "", c)}
                  </Text>
                  {c < colCount - 1 ? <Text>{GAP}</Text> : null}
                </Fragment>
              ))}
            </Text>
          ))}
        </Box>
      );
    }

    default:
      if ((token as Token).raw.length > 0) {
        return <Text>{(token as Token).raw}</Text>;
      }
      return null;
  }
}

export const MarkdownText = memo(function MarkdownText({
  source,
  cursor = false,
}: MarkdownTextProps): React.JSX.Element {
  const { theme } = useTheme();
  const tokens = useMemo(() => lexer(source), [source]);
  return (
    <Box flexDirection="column">
      {renderBlocks(tokens, theme)}
      {cursor ? <Text>▍</Text> : null}
    </Box>
  );
});
