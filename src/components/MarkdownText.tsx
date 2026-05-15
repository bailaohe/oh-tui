/**
 * MarkdownText — render a markdown subset to Ink primitives.
 *
 * Uses the lenient tokenizer in `lib/markdown.ts`. Supports:
 *   - headings (#/##/###) colored by level
 *   - code blocks (fenced, bordered, optional language label)
 *   - list items (-, *, +, "1.")
 *   - blockquote (> text) with a ▎ glyph prefix
 *   - inline: bold, italic, inline code, link
 *
 * When `cursor` is true, a trailing ▍ glyph renders to signal an in-flight
 * streaming response.
 */

import type React from "react";
import { Box, Text } from "ink";
import { tokenize, type Token, type InlineToken } from "../lib/markdown.js";
import { useTheme } from "../theme/ThemeContext.js";

export interface MarkdownTextProps {
  source: string;
  /** Show a trailing cursor (▍) — used during active streaming. */
  cursor?: boolean;
}

export function MarkdownText({
  source,
  cursor = false,
}: MarkdownTextProps): React.JSX.Element {
  const tokens = tokenize(source);
  return (
    <Box flexDirection="column">
      {tokens.map((tok, i) => (
        <BlockRender key={i} tok={tok} />
      ))}
      {cursor && <Text>▍</Text>}
    </Box>
  );
}

function BlockRender({ tok }: { tok: Token }): React.JSX.Element {
  const { theme } = useTheme();
  if (tok.type === "heading") {
    const color =
      tok.level === 1
        ? theme.colors.accent
        : tok.level === 2
          ? theme.colors.primary
          : theme.colors.warning;
    return (
      <Box marginTop={1}>
        <Text bold color={color}>
          {"#".repeat(tok.level)}{" "}
        </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  if (tok.type === "code_block") {
    return (
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="single"
        paddingX={1}
      >
        {tok.lang !== null && <Text dimColor>{tok.lang}</Text>}
        <Text>{tok.code}</Text>
      </Box>
    );
  }
  if (tok.type === "list_item") {
    return (
      <Box>
        <Text color={theme.colors.primary}>{tok.marker} </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  if (tok.type === "blockquote") {
    return (
      <Box>
        <Text color={theme.colors.primary}>▎ </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  return (
    <Box>
      <InlineRender tokens={tok.text} />
    </Box>
  );
}

function InlineRender({
  tokens,
}: {
  tokens: InlineToken[];
}): React.JSX.Element {
  return (
    <Text>
      {tokens.map((t, i) => {
        if (t.type === "text") return t.text;
        if (t.type === "bold")
          return (
            <Text key={i} bold>
              {t.text}
            </Text>
          );
        if (t.type === "italic")
          return (
            <Text key={i} italic>
              {t.text}
            </Text>
          );
        if (t.type === "code")
          return (
            <Text key={i} backgroundColor="gray" color="white">
              {" "}
              {t.text}{" "}
            </Text>
          );
        if (t.type === "link")
          return (
            <Text key={i} underline color="blue">
              {t.text}
            </Text>
          );
        return null;
      })}
    </Text>
  );
}
