/**
 * Helper to locate the `oh` bridge executable.
 *
 * Resolution order:
 *   1. Explicit path passed via --bridge-bin (if non-null and not the default "oh")
 *   2. `which oh` on PATH
 *   3. Friendly dev fallback: /Users/baihe/Projects/study/oh-mini/.venv/bin/oh
 *
 * Throws if none of the above resolve.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const DEV_FALLBACK = "/Users/baihe/Projects/study/oh-mini/.venv/bin/oh";

export function locateBridge(explicit: string | null): string {
  // If caller passed an explicit override (not the default "oh"), honor it verbatim.
  if (explicit && explicit !== "oh") return explicit;

  // Try PATH lookup.
  try {
    const found = execSync("which oh", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (found) return found;
  } catch {
    // fall through to dev fallback
  }

  // Friendly dev fallback for this workstation.
  if (existsSync(DEV_FALLBACK)) return DEV_FALLBACK;

  throw new Error("Cannot find `oh` on PATH. Pass --bridge-bin or install oh-mini.");
}
