#!/usr/bin/env node
/**
 * oh-tui CLI entry: parse argv, handle --help/--version, then render Ink App.
 */

import { render } from "ink";
import { App } from "./App.js";
import { teardownActiveBridge } from "./hooks/useBridgeClient.js";
import type { CliArgs } from "./types.js";

const VERSION = "0.7.4";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: null,
    exitOnDone: false,
    theme: "default",
    provider: null,
    profile: null,
    model: null,
    framing: "newline",
    bridgeBin: "oh",
    bridgeArgs: [],
    yolo: false,
    fullToolOutput: false,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      // pnpm v8+ forwards a literal `--` token to scripts when invoked as
      // `pnpm start -- --foo` (npm-style passthrough marker, not POSIX
      // positional separator — subsequent flags should still parse as flags).
      // Just skip it.
      continue;
    }
    if (a === "--prompt") {
      args.prompt = argv[++i] ?? null;
    } else if (a === "--exit-on-done") {
      args.exitOnDone = true;
    } else if (a === "--theme") {
      args.theme = argv[++i] ?? "default";
    } else if (a === "--provider") {
      args.provider = argv[++i] ?? null;
    } else if (a === "--profile") {
      args.profile = argv[++i] ?? null;
    } else if (a === "--model") {
      args.model = argv[++i] ?? null;
    } else if (a === "--framing") {
      const v = argv[++i];
      if (v === "newline" || v === "content-length") {
        args.framing = v;
      } else {
        console.error(`oh-tui: --framing expects 'newline' or 'content-length', got ${v ?? "(missing)"}`);
        process.exit(2);
      }
    } else if (a === "--bridge-bin") {
      args.bridgeBin = argv[++i] ?? "oh";
    } else if (a === "--yolo") {
      args.yolo = true;
    } else if (a === "--full-tool-output") {
      args.fullToolOutput = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version") {
      console.log(`oh-tui ${VERSION}`);
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`oh-tui: unknown option ${a}`);
      process.exit(2);
    } else {
      rest.push(a);
    }
  }

  // Positional argument = legacy OneShotMode behavior: --prompt + --exit-on-done.
  if (rest.length > 0 && args.prompt === null) {
    args.prompt = rest.join(" ");
    args.exitOnDone = true;
  }
  return args;
}

function printHelp(): void {
  console.log(`oh-tui [prompt] — Ink TUI for oh-mini

Usage:
  oh-tui                       start interactive REPL
  oh-tui "your prompt here"    legacy one-shot mode (= --prompt X --exit-on-done)
  oh-tui --prompt "X"          inject initial prompt then stay in REPL
  oh-tui --prompt "X" --exit-on-done   inject initial prompt then exit when done

Options:
  --prompt <text>              initial prompt (auto-submitted when bridge ready)
  --exit-on-done               exit after the first turn finishes
  --theme <name>               default | dark | minimal (default: default)
  --provider X                 provider name
  --profile P                  credentials profile
  --model M                    model override
  --framing F                  newline (default) | content-length
  --bridge-bin PATH            override path to the \`oh\` executable
  --yolo                       skip permission dialogs
  --full-tool-output           disable 5-line tool result truncation
  -h, --help                   show this help and exit
  --version                    print version and exit`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inst = render(<App args={args} />, { exitOnCtrlC: false });
  await inst.waitUntilExit();
  await Promise.race([
    teardownActiveBridge(),
    new Promise<void>((r) => setTimeout(r, 6000)),
  ]);
  process.exit(0);
}

void main();
