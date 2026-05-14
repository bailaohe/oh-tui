/**
 * TranscriptItemView — render a single transcript item.
 *
 * Switch by `item.kind`. The assistant branch currently delegates to
 * StreamingMessage; Task 3 swaps to MarkdownText, Task 5 swaps the tool-call
 * stub to ToolCallView.
 */

import type React from "react";
import { Box, Text } from "ink";
import type {
  TranscriptItem,
  SessionListEntry,
  ToolSpec,
} from "../types.js";
import { MarkdownText } from "./MarkdownText.js";

export interface TranscriptItemViewProps {
  item: TranscriptItem;
}

export function TranscriptItemView({
  item,
}: TranscriptItemViewProps): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text dimColor>&gt; </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          {item.toolCalls.length > 0 && (
            <Box flexDirection="column">
              {/* T5 swaps these for ToolCallView */}
              {item.toolCalls.map((c) => (
                <Text key={c.invocationId} dimColor>
                  · {c.tool} {c.status}
                </Text>
              ))}
            </Box>
          )}
          <MarkdownText source={item.text} cursor={!item.done} />
        </Box>
      );
    case "system":
      return <SystemBlock item={item} />;
  }
}

function SystemBlock({
  item,
}: {
  item: Extract<TranscriptItem, { kind: "system" }>;
}): React.JSX.Element {
  if (item.subkind === "sessions") {
    const sessions = item.payload as SessionListEntry[];
    return (
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="single"
        paddingX={1}
      >
        <Text bold>sessions</Text>
        {sessions.length === 0 ? (
          <Text dimColor>no sessions yet</Text>
        ) : (
          sessions.map((s) => (
            <Text key={s.id} dimColor>
              {s.id.slice(0, 8)}… · {s.message_count} msgs ·{" "}
              {s.created_at.slice(0, 19)}
            </Text>
          ))
        )}
      </Box>
    );
  }
  if (item.subkind === "tools") {
    const tools = item.payload as ToolSpec[];
    return (
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="single"
        paddingX={1}
      >
        <Text bold>tools</Text>
        {tools.map((t) => (
          <Box key={t.name}>
            <Text bold>{t.name}</Text>
            <Text dimColor> · {t.description}</Text>
          </Box>
        ))}
      </Box>
    );
  }
  if (item.subkind === "error") {
    return (
      <Box marginY={1}>
        <Text color="red">error: {String(item.payload)}</Text>
      </Box>
    );
  }
  return (
    <Box marginY={1}>
      <Text dimColor>{String(item.payload)}</Text>
    </Box>
  );
}
