/**
 * StatusBar — OpenHarness 风格分隔符行。
 *
 * 顶部一条 ── 分隔线；下方一行用 │ 分段显示：
 *   model: X │ tokens: 1.2k↓ 3.4k↑ │ mode: yolo │ sess a1b2c3d4 │ [cancel hint]
 * 各段只在数据存在时显示。
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  profile?: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  /** Token counters from telemetry, if available. */
  tokens?: { input: number; output: number } | null;
  /** Legacy: telemetry pulse string surfacing event_type + duration. */
  telemetry?: { event_type: string; elapsed_ms: number } | null;
  cancelHint?: string | null;
}

const SEP = " │ ";

export function StatusBar({
  provider,
  model,
  profile,
  sessionIdShort,
  yolo,
  tokens,
  telemetry,
  cancelHint,
}: StatusBarProps): React.JSX.Element {
  const { theme } = useTheme();

  const segments: React.ReactNode[] = [];

  // model + provider
  const modelLabel = model ?? "unknown";
  const providerLabel = provider ?? "unknown";
  segments.push(
    <Text key="model" color={theme.colors.primary} dimColor>
      model: {modelLabel}
    </Text>,
  );
  segments.push(
    <Text key="provider" dimColor>
      provider: {providerLabel}
    </Text>,
  );

  if (tokens !== null && tokens !== undefined && (tokens.input > 0 || tokens.output > 0)) {
    segments.push(
      <Text key="tokens" dimColor>
        tokens: {formatNum(tokens.input)}↓ {formatNum(tokens.output)}↑
      </Text>,
    );
  }

  if (yolo) {
    segments.push(
      <Text key="mode" dimColor>
        mode: yolo
      </Text>,
    );
  }

  if (profile !== null && profile !== undefined && profile !== "default") {
    segments.push(
      <Text key="profile" dimColor>
        @{profile}
      </Text>,
    );
  }

  if (sessionIdShort !== null) {
    segments.push(
      <Text key="sess" dimColor>
        sess {sessionIdShort}
      </Text>,
    );
  }

  if (cancelHint !== null && cancelHint !== undefined) {
    segments.push(
      <Text key="hint" color={theme.colors.warning}>
        {cancelHint}
      </Text>,
    );
  } else if (telemetry !== null && telemetry !== undefined) {
    segments.push(
      <Text key="telemetry" dimColor>
        {telemetry.event_type} · {telemetry.elapsed_ms}ms
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text dimColor>{"─".repeat(60)}</Text>
      <Box>
        <Text>
          {segments.flatMap((seg, i) =>
            i === 0 ? [seg] : [<Text key={`s${i}`} dimColor>{SEP}</Text>, seg],
          )}
        </Text>
      </Box>
    </Box>
  );
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
