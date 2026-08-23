/**
 * The part that is about desktops rather than tools.
 *
 * Measured on one task — open the calculator, compute 45+78, read the display —
 * a general coding agent handed the same desktop tools took 18 calls where an
 * agent built for desktops took 7. The tools were identical. The difference was
 * all here: reusing accessibility references after the tree had changed, then
 * clicking the same coordinates repeatedly because a click always reports
 * success whether or not anything happened.
 *
 * None of this can be shipped as a tool, which is why Kestrel is a fork.
 */

/** Identical failures: the second is warned, the third is refused. */
export const WARN_AT = 2
export const REFUSE_AT = 3

/** Identical *successful* actions get more rope, because clicking twice is normal. */
export const REPEAT_WARN_AT = 4
export const REPEAT_REFUSE_AT = 6

/** Tools that drive the mouse or keyboard, and so report success unconditionally. */
export const ACTING = new Set([
  "ui_click", "ui_type", "ui_focus",
  "computer_click", "computer_type", "computer_key",
  "computer_move", "computer_drag", "computer_scroll",
  "window_focus", "window_close", "window_arrange",
])

/** Tools whose result invalidates every accessibility reference held so far. */
const CHANGES_THE_TREE = new Set([
  "app_open", "app_close", "window_close", "window_focus", "window_arrange",
  "workspace_switch", "computer_key",
])

const REF_BEARING = new Set(["ui_click", "ui_type", "ui_read", "ui_focus"])

export type Verdict = { allow: true; warning?: string } | { allow: false; reason: string }

export class Discipline {
  private failures = new Map<string, number>()
  private repeats = new Map<string, number>()
  private staleRefs = false

  /** Called before a tool runs. */
  before(name: string, args: Record<string, unknown>): Verdict {
    const key = fingerprint(name, args)

    const repeated = this.repeats.get(key) ?? 0
    if (ACTING.has(name) && repeated >= REPEAT_REFUSE_AT - 1) {
      return {
        allow: false,
        reason:
          `Refused: ${name} has been called with exactly these arguments ${repeated} times. ` +
          `Every one reported success and nothing changed, which means it is not landing ` +
          `where you think it is. Look before acting again — computer_screenshot for the ` +
          `current state, or ui_snapshot for named elements with exact coordinates.`,
      }
    }

    const failed = this.failures.get(key) ?? 0
    if (failed >= REFUSE_AT - 1) {
      return {
        allow: false,
        reason:
          `Refused: ${name} has already failed the same way ${failed} times with these ` +
          `arguments. Running it again will not produce a different result. Change ` +
          `something real: re-read the screen, target a different element, or say what ` +
          `is stopping you.`,
      }
    }

    if (this.staleRefs && REF_BEARING.has(name) && args?.ref !== undefined) {
      this.staleRefs = false
      return {
        allow: true,
        warning:
          "The window changed since your last ui_snapshot, so accessibility references " +
          "from it are stale. Take a fresh ui_snapshot before acting on a ref.",
      }
    }
    return { allow: true }
  }

  /** Called after a tool runs. Returns a note to append to the result, or "". */
  after(name: string, args: Record<string, unknown>, ok: boolean): string {
    const key = fingerprint(name, args)
    if (CHANGES_THE_TREE.has(name) && ok) this.staleRefs = true
    if (name === "ui_snapshot") this.staleRefs = false

    if (!ok) {
      this.repeats.delete(key)
      const count = bump(this.failures, key)
      if (count < WARN_AT) return ""
      return (
        `\n\n[Attempt ${count} at ${name} with these exact arguments, failing the same way ` +
        `each time. Do not repeat it — look at the current state and try something else.]`
      )
    }

    this.failures.delete(key)
    if (!ACTING.has(name)) {
      this.repeats.delete(key)
      return ""
    }
    const count = bump(this.repeats, key)
    if (count < REPEAT_WARN_AT) return ""
    return (
      `\n\n[That is ${count} identical ${name} calls. It reports success every time because ` +
      `sending the event succeeds — that is not evidence anything happened. Take a ` +
      `screenshot, or find the element by name with ui_snapshot, before doing it again.]`
    )
  }
}

/** Fingerprints are kept per session; a long run must not grow without bound. */
const MAX_TRACKED = 200

function bump(counts: Map<string, number>, key: string): number {
  if (counts.size >= MAX_TRACKED && !counts.has(key)) counts.clear()
  const next = (counts.get(key) ?? 0) + 1
  counts.set(key, next)
  return next
}

export function fingerprint(name: string, args: Record<string, unknown>): string {
  let rendered: string
  try {
    rendered = JSON.stringify(args ?? {}, Object.keys(args ?? {}).sort())
  } catch {
    rendered = String(args)
  }
  return `${name}:${rendered.slice(0, 400)}`
}
