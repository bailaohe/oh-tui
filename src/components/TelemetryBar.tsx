/**
 * TelemetryBar — single-line status indicator pinned to the bottom of the
 * REPL.
 *
 * Surfaces the most recent `telemetry/event` notification from the bridge so
 * the operator gets a constant pulse of what the engine is doing
 * (e.g. `llm.requested · 1230ms`). The bar is intentionally non-interactive
 * and dim — it's a heartbeat, not a focal point, and PromptInput must keep
 * keyboard focus above it.
 *
 * Layout choices:
 *   - No border / no padding so the bar sits flush against the prompt and
 *     doesn't eat scrollback rows. Telemetry is high-frequency; a chunky
 *     panel would draw the eye every few hundred ms.
 *   - "idle" placeholder rather than rendering nothing so the row's vertical
 *     space is reserved from the first frame — otherwise the prompt would
 *     visibly jump down on the first telemetry tick.
 *   - The `latest` shape is denormalised to `{event_type, elapsed_ms}` by
 *     the caller so this component stays oblivious to the wire schema of
 *     `TelemetryEvent.payload`.
 */

import type React from "react";
import { Box, Text } from "ink";

export interface TelemetryBarProps {
  latest: { event_type: string; elapsed_ms: number } | null;
}

export function TelemetryBar({ latest }: TelemetryBarProps): React.JSX.Element {
  return (
    <Box>
      <Text dimColor>
        {latest !== null
          ? `${latest.event_type} · ${latest.elapsed_ms}ms`
          : "idle"}
      </Text>
    </Box>
  );
}
