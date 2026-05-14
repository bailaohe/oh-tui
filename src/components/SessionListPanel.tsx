/**
 * SessionListPanel — read-only display of prior sessions.
 *
 * Surfaced by ReplMode when the user types `/sessions`. Each row shows a
 * short id, the message count, and the creation timestamp. Selection
 * (arrow-key navigation + Enter to load) is deliberately out of scope for
 * v1 — the panel is purely informational, so we don't capture input here
 * and the PromptInput below it keeps focus.
 *
 * Layout choices:
 *   - Single-bordered box so it stands apart from the conversation log
 *     without screaming "modal" the way the yellow permission dialog does.
 *   - Empty-state line ("no sessions yet") rather than an empty box so the
 *     UI doesn't look broken when called against a fresh bridge.
 *   - Ids truncated to the same 8-char prefix the REPL header uses for the
 *     active session — visual continuity matters when the user is comparing
 *     "which one am I in?" with "which one was that?".
 */

import type React from "react";
import { Box, Text } from "ink";
import type { SessionListEntry } from "@meta-harney/bridge-client";

export interface SessionListPanelProps {
  sessions: SessionListEntry[];
}

export function SessionListPanel({
  sessions,
}: SessionListPanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      marginY={1}
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
