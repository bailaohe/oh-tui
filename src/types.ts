/**
 * Shared types for oh-tui.
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
