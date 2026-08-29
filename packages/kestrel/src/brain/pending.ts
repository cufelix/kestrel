/**
 * A lesson that outlives the process it was learned in.
 *
 * Reflection is a model call, and a one-shot `kestrel run` exits as soon as the
 * answer is on screen — which is the right way round; nobody should wait for a
 * lesson they did not ask for. But it also means the lesson is lost every time,
 * and one-shot runs are how most people use a command.
 *
 * So a run records what it did, and the *next* one reflects on it before
 * starting its own work. Nobody waits, and a lesson lands one run late — which
 * for a fact about a machine that will still be true next week is no cost.
 *
 * Known limitation, measured rather than assumed: in a one-shot `kestrel run`
 * the reflection cannot reach the in-process server it needs to ask the model
 * ("Unable to connect"), so nothing is learned there yet. The record survives,
 * is retried by later runs, and lands the first time Kestrel is used through
 * `kestrel serve` or the terminal interface, where reflection does work.
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type Unreflected = {
  task: string
  tools: string[]
}

const FILE = "pending.json"

/** How many runs may look at a lesson before it is given up on.
 *
 * The next run may itself be a one-liner that exits before the reflection's
 * model call returns, so dropping the record on the first look means a quick
 * run silently eats the lesson. Retrying forever would be worse.
 */
export const MAX_ATTEMPTS = 3

export class Pending {
  constructor(readonly directory: string = defaultDirectory()) {}

  private get file() {
    return path.join(this.directory, FILE)
  }

  /** Note what a run did, for the next one to think about. */
  async record(task: string, tools: string[]): Promise<void> {
    if (!tools.length) return
    try {
      await fs.mkdir(this.directory, { recursive: true })
      // Replaced, not appended: two lessons pending would mean spending a model
      // call on stale work, and the recent one is the one worth having.
      await fs.writeFile(this.file, JSON.stringify({ task, tools, attempts: 0 }), "utf8")
    } catch {
      /* a lesson is never worth failing a run over */
    }
  }

  /** Claim whatever is waiting, exactly once. */
  async take(): Promise<Unreflected | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, "utf8")
    } catch {
      return null
    }
    let parsed: (Unreflected & { attempts?: number }) | null = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (!parsed?.task || !Array.isArray(parsed.tools) || !parsed.tools.length) {
      // A record that cannot be read must not be retried on every start for
      // the rest of time.
      await this.done()
      return null
    }

    const attempts = Number(parsed.attempts ?? 0) + 1
    if (attempts > MAX_ATTEMPTS) {
      await this.done()
      return null
    }
    try {
      await fs.writeFile(this.file, JSON.stringify({ ...parsed, attempts }), "utf8")
    } catch {
      /* the next run will simply see the old count */
    }
    return { task: String(parsed.task), tools: parsed.tools.map(String) }
  }

  /** The lesson landed (or was definitively declined); stop offering it. */
  async done(): Promise<void> {
    try {
      await fs.unlink(this.file)
    } catch {
      /* already gone */
    }
  }
}

export function defaultDirectory(): string {
  return process.env.KESTREL_NOTES
    ? path.dirname(process.env.KESTREL_NOTES)
    : path.join(os.homedir(), ".kestrel")
}
