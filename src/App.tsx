/**
 * Top-level Ink component for oh-tui.
 *
 * Routes to OneShotMode when a prompt was passed via argv, otherwise to ReplMode.
 */

import type React from "react";
import { OneShotMode } from "./modes/OneShotMode.js";
import { ReplMode } from "./modes/ReplMode.js";
import type { CliArgs } from "./types.js";

export interface AppProps {
  args: CliArgs;
}

export function App({ args }: AppProps): React.JSX.Element {
  return args.prompt !== null ? <OneShotMode args={args} /> : <ReplMode args={args} />;
}
