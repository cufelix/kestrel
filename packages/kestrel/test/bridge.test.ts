/**
 * The bridge to the desktop layer.
 *
 * The hands are not reimplemented in TypeScript: the X11, AT-SPI and OCR layer
 * is the hardest, most platform-specific part of this problem and it already
 * exists. What has to be right here is that it is one long-lived process rather
 * than one per call, that a failure is a failure and not a hang, and that the
 * schemas it declares survive the trip.
 */

import { afterAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { McpBridge } from "../src/bridge/mcp"

const FAKE = path.join(import.meta.dir, "fake-desktop.ts")

function bridge() {
  return new McpBridge("bun", ["run", FAKE])
}

const started: McpBridge[] = []
function tracked() {
  const made = bridge()
  started.push(made)
  return made
}
afterAll(() => started.forEach((b) => b.stop()))

describe("starting", () => {
  test("lists the tools the far end declares", async () => {
    const hands = tracked()
    await hands.start()
    expect(hands.tools.map((t) => t.name)).toEqual(["window_list", "ui_click", "file_read"])
    expect(hands.instructions).toBe("made up instructions")
  })

  test("a banner printed before the protocol does not break it", async () => {
    // The real desktop layer prints "ready — 51 tools" to stderr on start.
    const hands = tracked()
    await hands.start()
    expect(hands.running).toBe(true)
  })

  test("starting twice starts one process", async () => {
    const hands = tracked()
    await Promise.all([hands.start(), hands.start(), hands.start()])
    expect(hands.tools).toHaveLength(3)
  })

  test("a command that does not exist fails rather than hanging", async () => {
    const hands = new McpBridge("kestrel-nothing-is-here", [])
    await expect(hands.start()).rejects.toThrow()
  })
})

describe("calling", () => {
  test("arguments arrive on the other side", async () => {
    const hands = tracked()
    const result = await hands.call("ui_click", { ref: 4 })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('"ref":4')
  })

  test("a tool that reports failure is reported as failure", async () => {
    const hands = tracked()
    expect((await hands.call("fails", {})).isError).toBe(true)
  })

  test("a protocol error is thrown, not swallowed", async () => {
    const hands = tracked()
    await expect(hands.call("explode", {})).rejects.toThrow("it exploded")
  })

  test("calls do not have to wait for each other", async () => {
    const hands = tracked()
    const [a, b, c] = await Promise.all([
      hands.call("window_list", { match: "a" }),
      hands.call("window_list", { match: "b" }),
      hands.call("window_list", { match: "c" }),
    ])
    expect(a.text).toContain('"a"')
    expect(b.text).toContain('"b"')
    expect(c.text).toContain('"c"')
  })

  test("calling starts the bridge if nobody did", async () => {
    const hands = tracked()
    expect((await hands.call("window_list", {})).text).toContain("window_list")
  })
})

describe("stopping", () => {
  test("leaves nothing running", async () => {
    const hands = bridge()
    await hands.start()
    hands.stop()
    expect(hands.running).toBe(false)
  })

  test("a call in flight when it stops rejects rather than hanging", async () => {
    const hands = bridge()
    await hands.start()
    const inflight = hands.call("window_list", {})
    hands.stop()
    await expect(inflight).rejects.toThrow()
  })
})
