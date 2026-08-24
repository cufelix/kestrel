/**
 * The part that is about desktops rather than tools.
 *
 * Measured on one task — open the calculator, compute 45+78, read the display —
 * a general coding agent handed these same tools took 18 calls where an agent
 * built for desktops took 7. Everything here is one of the reasons why.
 */

import { describe, expect, test } from "bun:test"
import { Discipline, REFUSE_AT, REPEAT_REFUSE_AT, REPEAT_WARN_AT, fingerprint } from "../src/brain/discipline"

function refuse(d: Discipline, name: string, args: any, times: number, ok: boolean) {
  for (let i = 0; i < times; i++) {
    d.before(name, args)
    d.after(name, args, ok)
  }
  return d.before(name, args)
}

describe("an action that keeps failing", () => {
  test("is refused once the evidence is conclusive", () => {
    const d = new Discipline()
    const verdict = refuse(d, "ui_click", { ref: 5 }, REFUSE_AT - 1, false)
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toContain("failed the same way")
  })

  test("is warned about before it is refused", () => {
    const d = new Discipline()
    d.before("ui_click", { ref: 5 })
    expect(d.after("ui_click", { ref: 5 }, false)).toBe("")
    d.before("ui_click", { ref: 5 })
    expect(d.after("ui_click", { ref: 5 }, false)).toContain("Attempt 2")
  })

  test("a different target is exploration, not repetition", () => {
    const d = new Discipline()
    for (let i = 0; i < 10; i++) {
      expect(d.before("ui_click", { ref: i }).allow).toBe(true)
      d.after("ui_click", { ref: i }, false)
    }
  })

  test("succeeding clears the count, because the world moved", () => {
    const d = new Discipline()
    d.before("ui_click", { ref: 5 })
    d.after("ui_click", { ref: 5 }, false)
    d.before("ui_click", { ref: 5 })
    d.after("ui_click", { ref: 5 }, true)
    d.before("ui_click", { ref: 5 })
    expect(d.after("ui_click", { ref: 5 }, false)).toBe("")
  })
})

describe("an action that reports success and changes nothing", () => {
  test("is refused after six identical attempts", () => {
    // A click succeeds as soon as the event is sent. Repetition is the only
    // evidence available that it is landing somewhere else.
    const d = new Discipline()
    const verdict = refuse(d, "computer_click", { x: 333, y: 324 }, REPEAT_REFUSE_AT - 1, true)
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toContain("not landing where you think")
  })

  test("clicking one button twice is ordinary", () => {
    const d = new Discipline()
    for (let i = 0; i < REPEAT_WARN_AT - 1; i++) {
      d.before("computer_click", { x: 1, y: 2 })
      expect(d.after("computer_click", { x: 1, y: 2 }, true)).toBe("")
    }
  })

  test("reading the same thing repeatedly is never repetition", () => {
    // Polling until something changes is how waiting works.
    const d = new Discipline()
    for (let i = 0; i < REPEAT_REFUSE_AT * 3; i++) {
      expect(d.before("window_list", {}).allow).toBe(true)
      expect(d.after("window_list", {}, true)).toBe("")
    }
  })
})

describe("accessibility references", () => {
  test("are marked stale when a window opens", () => {
    const d = new Discipline()
    d.after("app_open", { name: "Calculator" }, true)
    const verdict = d.before("ui_click", { ref: 3 })
    expect(verdict.allow).toBe(true)
    if (verdict.allow) expect(verdict.warning).toContain("stale")
  })

  test("are fresh again after a snapshot", () => {
    const d = new Discipline()
    d.after("app_open", { name: "Calculator" }, true)
    d.after("ui_snapshot", {}, true)
    const verdict = d.before("ui_click", { ref: 3 })
    expect(verdict.allow && verdict.warning).toBeFalsy()
  })

  test("the warning is given once, not on every call", () => {
    const d = new Discipline()
    d.after("window_focus", { id: 1 }, true)
    expect((d.before("ui_click", { ref: 3 }) as any).warning).toBeTruthy()
    expect((d.before("ui_click", { ref: 4 }) as any).warning).toBeFalsy()
  })

  test("clicking by name is not affected — a name survives a window moving", () => {
    const d = new Discipline()
    d.after("app_open", { name: "Calculator" }, true)
    expect((d.before("ui_click", { name: "Save" }) as any).warning).toBeFalsy()
  })
})

describe("fingerprints", () => {
  test("do not depend on the order the arguments were written in", () => {
    expect(fingerprint("ui_click", { a: 1, b: 2 })).toBe(fingerprint("ui_click", { b: 2, a: 1 }))
  })

  test("tell different tools apart", () => {
    expect(fingerprint("ui_click", { a: 1 })).not.toBe(fingerprint("ui_type", { a: 1 }))
  })
})
