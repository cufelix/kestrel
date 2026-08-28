/**
 * Learning without being asked.
 *
 * A tool the model may call is not a memory. It is a memory the model has to
 * remember to use — which it does when prompted, and forgets when it is busy
 * finishing the actual task. Every agent with a `remember` tool and nothing
 * else learns exactly as much as its user nags it to.
 *
 * So the noticing happens on its own, once, when a task ends: what did this
 * run teach about this machine that a later one would be faster for knowing?
 * Almost always nothing, and answering "nothing" is the common case and must
 * be cheap.
 *
 * The filter afterwards is the important half. Asked what it learned, a model
 * will happily report the answer to the question it was just given — "45 + 78
 * = 123" — which is arithmetic, will never be true of anything else, and costs
 * context every time it is recalled.
 */

import type { Notes } from "./notes"

export type Ask = (prompt: string) => Promise<string>

export type ReflectorOptions = {
  notes: Notes
  ask: Ask
  /** Give up after this. A lesson is never worth making somebody wait. */
  timeoutMs?: number
}

/** Long enough for a slow free model to answer.
 *
 * This does not block anything — the reflection runs after the answer is
 * already on screen — so the only cost of waiting is a process that lingers a
 * little in a one-shot run. Thirty seconds was shorter than the model and
 * every reflection was silently thrown away.
 */
export const DEFAULT_TIMEOUT = 120_000

/** Tools that mean the run actually touched the machine. */
const TOUCHED_THE_DESKTOP = /^(app_|ui_|computer_|window_|workspace_|ocr_|clipboard_)/

const PROMPT = `A desktop agent has just finished a task on this computer.

Task: {task}
Tools it used: {tools}

What did this run teach about THIS MACHINE that a later task would be faster
for knowing? Facts about the computer — which application a category opens, a
control that is not where it looks, a step that is always needed, something
that has to be read a particular way.

NOT the answer to the task. NOT that the task succeeded. NOT arithmetic.
If you cannot say how a later task would be faster for knowing it, there is
nothing to record.

Reply with nothing but:

topic: <two or three words>
fact: <one sentence, stated as fact>

Several may be listed, separated by a blank line. If there is nothing worth
recording — which is the usual answer — reply with exactly: NOTHING`

/** Phrasings that mean "the task went well", not "this is how the machine is". */
const NOT_A_FACT = [
  /^\s*nothing\b/i,
  /\bsuccessfully\b/i,
  /\btask (completed|succeeded|finished)\b/i,
  /\bi (opened|clicked|typed|ran|used)\b/i,
  /\bthe (result|answer) (was|is)\b/i,
  /^\s*[\d\s+\-*/×÷=.]+\s*$/,
  /\bworks\b\s*$/i,
]

/** A fact needs enough substance to be worth a line in a file somebody reads. */
const SHORTEST_USEFUL_FACT = 20

export function worthKeeping(topic: string, fact: string): boolean {
  const line = (fact ?? "").trim()
  if (line.length < SHORTEST_USEFUL_FACT) return false
  if (!(topic ?? "").trim()) return false
  if (NOT_A_FACT.some((pattern) => pattern.test(line))) return false
  // A "fact" that is mostly digits is the answer to a sum, not a property of a
  // computer.
  const digits = (line.match(/\d/g) ?? []).length
  return digits / line.length < 0.3
}

export class Reflector {
  constructor(private readonly options: ReflectorOptions) {}

  /**
   * Consider what this run taught, and write down anything durable.
   *
   * Never throws: losing a lesson must not fail the run it came from.
   */
  async reflect(task: string, tools: string[]): Promise<string[]> {
    if (!tools.some((name) => TOUCHED_THE_DESKTOP.test(name))) return []

    const prompt = PROMPT.replace("{task}", task.slice(0, 400)).replace(
      "{tools}",
      [...new Set(tools)].join(", ") || "none",
    )

    let answer: string
    try {
      answer = await withTimeout(
        this.options.ask(prompt),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT,
      )
    } catch (error) {
      // Not silent: a reflection that never lands looks exactly like an agent
      // that learned nothing, and the two want very different fixes.
      if (process.env.KESTREL_TRACE) {
        console.error(`kestrel-trace: reflection failed — ${error}`)
      }
      return []
    }

    if (process.env.KESTREL_TRACE) {
      console.error(`kestrel-trace: reflection said ${JSON.stringify(answer.slice(0, 120))}`)
    }

    const kept: string[] = []
    for (const { topic, fact } of parse(answer)) {
      if (!worthKeeping(topic, fact)) continue
      try {
        const result = await this.options.notes.remember(topic, fact)
        if (result.added) kept.push(result.topic)
      } catch {
        continue
      }
    }
    return kept
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("reflection timed out")), ms)),
  ])
}

/** Pull `topic:`/`fact:` pairs out of the reply, and nothing else. */
export function parse(answer: string): Array<{ topic: string; fact: string }> {
  const out: Array<{ topic: string; fact: string }> = []
  let topic = ""
  for (const raw of (answer ?? "").split("\n")) {
    const line = raw.trim()
    const asTopic = /^topic\s*:\s*(.+)$/i.exec(line)
    if (asTopic) {
      topic = asTopic[1].trim()
      continue
    }
    const asFact = /^fact\s*:\s*(.+)$/i.exec(line)
    // A fact with no topic above it is the model improvising a different
    // format, and guessing at what it meant is how nonsense gets filed.
    if (asFact && topic) {
      out.push({ topic, fact: asFact[1].trim() })
      topic = ""
    }
  }
  return out
}
