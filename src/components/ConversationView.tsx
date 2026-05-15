/**
 * ConversationView — top-level transcript renderer.
 *
 * Responsibilities:
 *   - Show WelcomeBanner when transcript is empty.
 *   - Split items into `completed` (rendered inside <Static>) and `active`
 *     (rendered dynamically). The cut is at `activeAssistantId`.
 *   - Group adjacent `tool` + `tool_result` pairs (matched by invocationId)
 *     and hand them to <ToolCallDisplay>.
 *   - Render non-tool rows by role: user / assistant via MarkdownText /
 *     system via SystemBlock.
 *
 * Static + group: a paired tool/tool_result becomes a single Static row; we
 * use `${tool.id}+${result.id}` as the group key so it stays stable across
 * renders.
 */

import type React from "react";
import { Box, Static, Text } from "ink";
import type { SessionListEntry, ToolSpec } from "../types.js";
import type { TranscriptItem } from "../types.js";
import { MarkdownText } from "./MarkdownText.js";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { WelcomeBanner } from "./WelcomeBanner.js";

export interface ConversationViewProps {
  items: TranscriptItem[];
  activeAssistantId: string | null;
  showWelcome: boolean;
  version: string;
  fullToolOutput: boolean;
}

type GroupedItem = TranscriptItem | { pair: [TranscriptItem, TranscriptItem]; key: string };

function isPair(g: GroupedItem): g is { pair: [TranscriptItem, TranscriptItem]; key: string } {
  return (g as { pair?: unknown }).pair !== undefined;
}

export function groupAdjacentToolPairs(items: TranscriptItem[]): GroupedItem[] {
  const out: GroupedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    const next = items[i + 1];
    if (
      cur.role === "tool" &&
      next !== undefined &&
      next.role === "tool_result" &&
      cur.invocationId !== undefined &&
      cur.invocationId === next.invocationId
    ) {
      out.push({ pair: [cur, next], key: `${cur.id}+${next.id}` });
      i++; // skip the consumed tool_result
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function ConversationView({
  items,
  activeAssistantId,
  showWelcome,
  version,
  fullToolOutput,
}: ConversationViewProps): React.JSX.Element {
  // Cut at the active streaming row (assistant OR thinking). Items before
  // it are immutable from Ink's perspective (Static-safe); items from it
  // onwards may still mutate as tokens stream in.
  let cutIdx: number;
  if (activeAssistantId === null) {
    cutIdx = items.length;
  } else {
    const idx = items.findIndex((it) => it.id === activeAssistantId);
    cutIdx = idx === -1 ? items.length : idx;
  }
  const completed = items.slice(0, cutIdx);
  const active = items.slice(cutIdx);

  const completedGroups = groupAdjacentToolPairs(completed);
  const activeGroups = groupAdjacentToolPairs(active);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {showWelcome && completed.length === 0 && active.length === 0 && (
        <WelcomeBanner version={version} />
      )}
      <Static items={completedGroups}>
        {(g) => (
          <GroupBlock
            key={isPair(g) ? g.key : g.id}
            group={g}
            fullToolOutput={fullToolOutput}
          />
        )}
      </Static>
      {activeGroups.map((g) => (
        <GroupBlock
          key={isPair(g) ? g.key : g.id}
          group={g}
          fullToolOutput={fullToolOutput}
        />
      ))}
    </Box>
  );
}

function GroupBlock({
  group,
  fullToolOutput,
}: {
  group: GroupedItem;
  fullToolOutput: boolean;
}): React.JSX.Element {
  if (isPair(group)) {
    const [tool, result] = group.pair;
    return (
      <ToolCallDisplay tool={tool} result={result} fullToolOutput={fullToolOutput} />
    );
  }
  const item = group;
  if (item.role === "user") {
    return (
      <Box marginTop={1}>
        <Text dimColor>&gt; </Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }
  if (item.role === "assistant") {
    return (
      <Box flexDirection="column">
        <MarkdownText source={item.text} cursor={item.done !== true} />
      </Box>
    );
  }
  if (item.role === "thinking") {
    // Streamed alongside / before assistant text. Rendered dim + indented so
    // it visually recedes from the real reply.
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor bold>
          ✻ Thinking
        </Text>
        <Box marginLeft={2}>
          <Text dimColor>
            {item.text}
            {item.done !== true ? "▍" : ""}
          </Text>
        </Box>
      </Box>
    );
  }
  if (item.role === "tool") {
    // Unpaired tool — still running (no matching result yet).
    return (
      <ToolCallDisplay
        tool={item}
        fullToolOutput={fullToolOutput}
      />
    );
  }
  if (item.role === "tool_result") {
    // Orphan tool_result (shouldn't happen in normal flow). Render as dim
    // text so we don't silently lose data.
    return (
      <Box marginLeft={2}>
        <Text dimColor>{item.text}</Text>
      </Box>
    );
  }
  // role === "system"
  return <SystemBlock item={item} />;
}

function SystemBlock({ item }: { item: TranscriptItem }): React.JSX.Element {
  const subkind = item.subkind;
  if (subkind === "sessions") {
    const sessions = item.payload as SessionListEntry[];
    return (
      <Box flexDirection="column" marginY={1} borderStyle="single" paddingX={1}>
        <Text bold>sessions</Text>
        {sessions.length === 0 ? (
          <Text dimColor>no sessions yet</Text>
        ) : (
          sessions.map((s) => (
            <Text key={s.id} dimColor>
              {s.id.slice(0, 8)}… · {s.message_count} msgs · {s.created_at.slice(0, 19)}
            </Text>
          ))
        )}
      </Box>
    );
  }
  if (subkind === "tools") {
    const tools = item.payload as ToolSpec[];
    return (
      <Box flexDirection="column" marginY={1} borderStyle="single" paddingX={1}>
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
  if (subkind === "error") {
    return (
      <Box marginY={1}>
        <Text color="red">error: {String(item.payload)}</Text>
      </Box>
    );
  }
  // info / default
  return (
    <Box marginY={1}>
      <Text dimColor>{String(item.payload ?? item.text)}</Text>
    </Box>
  );
}
