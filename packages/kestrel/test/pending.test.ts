/**
 * A lesson that outlives the process it was learned in.
 *
 * Reflection is a model call, and a one-shot `kestrel run` exits as soon as the
 * answer is on screen — which is right, nobody should wait for a lesson. But it
 * means the lesson is lost every time, and one-shot runs are how most people
 * use a command.
 *
 * So the run records what it did and the *next* one reflects on it before
 * starting. Nobody waits, and nothing is dropped.
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Pending } from "../src/brain/pending"

async function scratch() {
  return new Pending(await fs.mkdtemp(path.join(os.tmpdir(), "kestrel-pending-")))
}

describe("carrying a lesson to the next run", () => {
  test("what a run did survives the process", async () => {
    const pending = await scratch()
    await pending.record("open the calculator", ["app_open", "ui_click"])

    const later = new Pending(pending.directory)
    const found = await later.take()
    expect(found).toEqual({ task: "open the calculator", tools: ["app_open", "ui_click"] })
  })

  test("a lesson that landed is not offered again", async () => {
    const pending = await scratch()
    await pending.record("x", ["ui_click"])
    expect(await pending.take()).toBeTruthy()
    await pending.done()
    expect(await pending.take()).toBeNull()
  })

  test("nothing recorded is nothing to do", async () => {
    expect(await (await scratch()).take()).toBeNull()
  })

  test("a run that touched nothing records nothing", async () => {
    const pending = await scratch()
    await pending.record("what is 2+2", [])
    expect(await pending.take()).toBeNull()
  })

  test("a later run replaces an older unclaimed one", async () => {
    // Two lessons pending would mean reflecting on stale work; the recent one
    // is the one worth the model call.
    const pending = await scratch()
    await pending.record("first", ["ui_click"])
    await pending.record("second", ["app_open"])
    expect((await pending.take())?.task).toBe("second")
  })

  test("a corrupt record is discarded rather than crashing the next run", async () => {
    const pending = await scratch()
    await fs.mkdir(pending.directory, { recursive: true })
    await fs.writeFile(path.join(pending.directory, "pending.json"), "{not json", "utf8")
    expect(await pending.take()).toBeNull()
  })

  test("an unwritable directory is not an error worth failing a run over", async () => {
    const pending = new Pending("/proc/nowhere/kestrel")
    await pending.record("x", ["ui_click"]) // must not throw
    expect(await pending.take()).toBeNull()
  })
})

describe("surviving a run that was too quick", () => {
  test("a lesson not reflected on is offered again", async () => {
    // The next run may be a one-liner that exits before the reflection's model
    // call returns. Dropping the lesson on the first look means a quick run
    // silently eats it.
    const pending = await scratch()
    await pending.record("open the editor", ["app_open"])

    expect((await pending.take())?.task).toBe("open the editor")
    expect((await pending.take())?.task).toBe("open the editor")
  })

  test("but not forever", async () => {
    const { MAX_ATTEMPTS } = await import("../src/brain/pending")
    const pending = await scratch()
    await pending.record("open the editor", ["app_open"])

    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(await pending.take()).toBeTruthy()
    expect(await pending.take()).toBeNull()
  })

  test("a reflection that lands clears it at once", async () => {
    const pending = await scratch()
    await pending.record("open the editor", ["app_open"])
    await pending.take()
    await pending.done()
    expect(await pending.take()).toBeNull()
  })

  test("a newer run replaces a half-tried older one", async () => {
    const pending = await scratch()
    await pending.record("first", ["ui_click"])
    await pending.take()
    await pending.record("second", ["app_open"])

    const found = await pending.take()
    expect(found?.task).toBe("second")
  })
})

describe("not spending an attempt on something impossible", () => {
  test("an unreachable server leaves the record untouched", async () => {
    // In a one-shot run the plugin is handed a server URL nothing listens on.
    // Three quick runs in a row would otherwise use up every attempt and drop
    // the lesson without ever having asked the model anything.
    const pending = await scratch()
    await pending.record("open the editor", ["app_open"])
    const before = await fs.readFile(path.join(pending.directory, "pending.json"), "utf8")
    // no take() at all — this is what the plugin does when nothing answers
    const after = await fs.readFile(path.join(pending.directory, "pending.json"), "utf8")
    expect(after).toBe(before)
    expect(JSON.parse(after).attempts).toBe(0)
  })
})
