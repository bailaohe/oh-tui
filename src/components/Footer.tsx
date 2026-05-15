/**
 * Footer — single line at the bottom of the screen with static environment
 * info. Mirrors OpenHarness's bottom-line summary but trimmed to the subset
 * oh-mini actually surfaces.
 */

import type React from "react";
import { Box, Text } from "ink";

export interface FooterProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  authStatus?: string;
}

export function Footer({
  provider,
  model,
  sessionIdShort,
  yolo,
  authStatus = "ok",
}: FooterProps): React.JSX.Element {
  return (
    <Box marginTop={1} width="100%">
      <Text dimColor>
        model={model ?? "unknown"} provider={provider ?? "unknown"}{" "}
        auth={authStatus} yolo={String(yolo)}{" "}
        session={sessionIdShort ?? "—"}
      </Text>
    </Box>
  );
}
