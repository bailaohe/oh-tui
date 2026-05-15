/**
 * useTerminalWidth — re-renders on terminal resize.
 *
 * Ink's <Box width="100%"> handles flex sizing, but some renderers need a
 * concrete character count (e.g. `"─".repeat(width)`). This hook subscribes
 * to stdout's "resize" event and surfaces the current column count.
 */

import { useEffect, useState } from "react";
import { useStdout } from "ink";

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState<number>(stdout.columns ?? 80);

  useEffect(() => {
    const onResize = (): void => {
      setWidth(stdout.columns ?? 80);
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return width;
}
