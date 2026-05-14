/**
 * StreamingMessage — render an assistant text response that accumulates
 * `text_delta` chunks over time. A trailing block cursor (▍) is shown while
 * the stream is still active so the user can visually tell streaming hasn't
 * stalled vs. simply finished.
 *
 * Stateless / pure: the parent (mode component) owns the buffer and the
 * `finished` flag; this is just a presentation primitive.
 */

import type React from "react";
import { Box, Text } from "ink";

export interface StreamingMessageProps {
  text: string;
  finished: boolean;
}

export function StreamingMessage({
  text,
  finished,
}: StreamingMessageProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        {text}
        {!finished && "▍"}
      </Text>
    </Box>
  );
}
