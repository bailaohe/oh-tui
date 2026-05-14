/**
 * ToolsListPanel — read-only display of runtime tool specs.
 *
 * Surfaced by ReplMode when the user types `/tools`. Each row pairs a tool
 * name with its description. Like SessionListPanel this is informational
 * only — we don't capture keyboard input, so PromptInput keeps focus and
 * the next `/tools` toggles the panel away.
 *
 * Layout choices:
 *   - Single-bordered box, matching SessionListPanel for visual parity.
 *   - Empty-state line rather than an empty box so misconfigured runtimes
 *     (no tools registered) render something legible instead of a void.
 *   - Description rendered dim and on the same line as the name so a wide
 *     toolset stays compact; long descriptions wrap naturally because we
 *     don't pin a width.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { ToolSpec } from "@meta-harney/bridge-client";

export interface ToolsListPanelProps {
  tools: ToolSpec[];
}

export function ToolsListPanel({
  tools,
}: ToolsListPanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      marginY={1}
    >
      <Text bold>tools</Text>
      {tools.length === 0 ? (
        <Text dimColor>no tools registered</Text>
      ) : (
        tools.map((t) => (
          <Box key={t.name}>
            <Text bold>{t.name}</Text>
            {t.description.length > 0 && (
              <Text dimColor> · {t.description}</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
