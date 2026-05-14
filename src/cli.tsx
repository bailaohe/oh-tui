#!/usr/bin/env node
/**
 * oh-tui CLI entry: parse argv, handle --help/--version, then render Ink App.
 */

import { render } from "ink";
import { App } from "./App.js";
import { teardownActiveBridge } from "./hooks/useBridgeClient.js";
import type { CliArgs } from "./types.js";

const VERSION = "0.1.0";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: null,
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
    if (a === "--provider") {
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

  if (rest.length > 0) args.prompt = rest.join(" ");
  return args;
}

function printHelp(): void {
  console.log(`oh-tui [prompt] — Ink TUI for oh-mini

Usage:
  oh-tui                       start interactive REPL
  oh-tui "your prompt here"    one-shot mode

Options:
  --provider X                 provider name (e.g. anthropic, openai)
  --profile P                  credentials profile
  --model M                    model override
  --framing F                  newline (default) | content-length
  --bridge-bin PATH            override path to the \`oh\` executable
  --yolo                       skip permission dialogs (auto-approve tools)
  --full-tool-output           disable 5-line tool result truncation
  -h, --help                   show this help and exit
  --version                    print version and exit`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // exitOnCtrlC=false lets `useCancelBinding` claim Ctrl+C so it can fire
  // `$/cancelRequest` instead of nuking the process mid-stream. If no
  // in-flight handle exists, modes still fall through to a normal exit
  // (REPL via `/exit`, OneShot after `handle.done`).
  const inst = render(<App args={args} />, { exitOnCtrlC: false });
  await inst.waitUntilExit();
  // Ink has unmounted; useEffect cleanup published the live client to a
  // module-level singleton. Drain the bridge subprocess so node can quit.
  // Bounded so a wedged bridge can't keep us alive forever.
  await Promise.race([
    teardownActiveBridge(),
    new Promise<void>((r) => setTimeout(r, 6000)),
  ]);
  process.exit(0);
}

void main();
