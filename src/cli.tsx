#!/usr/bin/env node
/**
 * oh-tui CLI entry.
 *
 * NOTE: This is a Task 10 stub. Real arg parsing + Ink render lands in T11+.
 */

import { render } from "ink";
import { App } from "./App.js";
import type { CliArgs } from "./types.js";

function main(): void {
  const args: CliArgs = {
    prompt: null,
    provider: null,
    profile: null,
    model: null,
    framing: "newline",
    bridgeBin: "oh-mini-bridge",
    bridgeArgs: [],
    yolo: false,
  };

  render(<App args={args} />);
}

main();
