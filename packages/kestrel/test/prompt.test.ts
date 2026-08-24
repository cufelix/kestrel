/**
 * What the agent is told before it starts.
 *
 * The host's own prompt is about editing code in a repository. Nothing in it
 * says there is a screen, that the screen has an accessibility tree, or that a
 * click reports success whether or not it landed.
 */

import { describe, expect, test } from "bun:test"
import { DESKTOP_PROTOCOL, knowledge } from "../src/brain/protocol"

describe("the desktop protocol", () => {
  test("says to read before acting", () => {
    expect(DESKTOP_PROTOCOL).toContain("ui_snapshot")
    expect(DESKTOP_PROTOCOL.toLowerCase()).toContain("read before acting")
  })

  test("warns that references go stale", () => {
    // The single most common way a desktop task goes wrong.
    expect(DESKTOP_PROTOCOL).toContain("stale")
  })

  test("says that a click reporting success proves nothing", () => {
    expect(DESKTOP_PROTOCOL).toContain("whether or not anything happened")
  })

  test("points at OCR for text the tree does not expose", () => {
    expect(DESKTOP_PROTOCOL).toContain("ocr_read")
  })

  test("asks it to write down what it learns", () => {
    expect(DESKTOP_PROTOCOL).toContain("kestrel_remember")
  })
})

describe("recalled knowledge", () => {
  test("is presented as fact, and as correctable", () => {
    const block = knowledge([{ topic: "calculator", body: "- display is not in the tree", updated: 0 }])
    expect(block).toContain("calculator")
    expect(block).toContain("display is not in the tree")
    expect(block).toContain("kestrel_remember")
  })

  test("nothing learned costs nothing", () => {
    expect(knowledge([])).toBe("")
  })

  test("the markdown heading of a note is not repeated", () => {
    const block = knowledge([{ topic: "editor", body: "# editor\n- it is Xed", updated: 0 }])
    expect(block.match(/editor/g)?.length).toBeLessThan(3)
  })
})
