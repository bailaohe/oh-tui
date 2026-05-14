/**
 * Shared types for oh-tui.
 *
 * NOTE: This is a Task 10 stub. Real types land in T11+.
 */

export interface CliArgs {
  prompt: string | null;
  provider: string | null;
  profile: string | null;
  model: string | null;
  framing: "newline" | "content-length";
  bridgeBin: string;
  bridgeArgs: string[];
  yolo: boolean;
}
