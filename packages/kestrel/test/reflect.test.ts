/**
 * Learning without being asked.
 *
 * A tool the model may call is not a memory — it is a memory the model has to
 * remember to use, which it does when prompted and forgets when busy. An agent
 * that improves does the noticing itself, at the moment a task ends.
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Notes } from "../src/brain/notes"
import { Reflector, worthKeeping } from "../src/brain/reflect"

async function scratch() {
  return new Notes(await fs.mkdtemp(path.join(os.tmpdir(), "kestrel-reflect-")))
}

function reflector(answer: string, notes: Notes, seen: string[] = []) {
  return new Reflector({
    notes,
    ask: async (prompt: string) => {
      seen.push(prompt)
      return answer
    },
  })
}

describe("what is worth keeping", () => {
  test("a fact about the machine is", () => {
    expect(worthKeeping("editor", "The text editor is Xed")).toBe(true)
  })

  test("the answer to the task just finished is not", () => {
    // "45 + 78 = 123" is arithmetic. It will not make a later task faster.
    expect(worthKeeping("calculator", "45 + 78 = 123")).toBe(false)
    expect(worthKeeping("calculator", "The result was 123")).toBe(false)
  })

  test("an event is not a fact", () => {
    expect(worthKeeping("firefox", "I opened Firefox successfully")).toBe(false)
    expect(worthKeeping("editor", "The task completed")).toBe(false)
  })

  test("something that says nothing usable is not", () => {
    expect(worthKeeping("calculator", "The calculator works")).toBe(false)
    expect(worthKeeping("x", "ok")).toBe(false)
  })

  test("a refusal to answer is not a fact", () => {
    expect(worthKeeping("none", "NOTHING")).toBe(false)
    expect(worthKeeping("none", "nothing worth remembering")).toBe(false)
  })
})

describe("reflecting at the end of a task", () => {
  test("writes what it noticed, without being asked", async () => {
    const notes = await scratch()
    await reflector(
      "topic: text editor\nfact: The text editor on this machine is Xed",
      notes,
    ).reflect("open the text editor", ["app_open", "ui_type"])

    const [note] = await notes.list()
    expect(note.topic).toBe("text-editor")
    expect(note.body).toContain("Xed")
  })

  test("is given the task and what was actually done", async () => {
    const seen: string[] = []
    const notes = await scratch()
    await reflector("NOTHING", notes, seen).reflect("open the calculator", ["app_open", "ui_click"])
    expect(seen[0]).toContain("open the calculator")
    expect(seen[0]).toContain("app_open")
  })

  test("keeps quiet when there is nothing to say", async () => {
    const notes = await scratch()
    await reflector("NOTHING", notes).reflect("say hello", ["ui_snapshot"])
    expect(await notes.list()).toEqual([])
  })

  test("does not file the answer to the task", async () => {
    const notes = await scratch()
    await reflector("topic: calculator\nfact: 45 + 78 = 123", notes).reflect("add numbers", ["ui_click"])
    expect(await notes.list()).toEqual([])
  })

  test("a model that ignores the format is not guessed at", async () => {
    const notes = await scratch()
    await reflector("Well, I think maybe the editor is interesting?", notes).reflect("x", ["ui_click"])
    expect(await notes.list()).toEqual([])
  })

  test("several facts in one answer are all kept", async () => {
    const notes = await scratch()
    await reflector(
      "topic: text editor\nfact: The text editor is Xed\n\ntopic: calculator\nfact: The calculator display needs OCR to read",
      notes,
    ).reflect("x", ["app_open"])
    expect((await notes.list()).map((n) => n.topic).sort()).toEqual(["calculator", "text-editor"])
  })

  test("a model that fails is not a task that fails", async () => {
    // Losing a lesson must never fail the run it came from.
    const notes = await scratch()
    const broken = new Reflector({
      notes,
      ask: async () => {
        throw new Error("the model is down")
      },
    })
    await broken.reflect("x", ["ui_click"])
    expect(await notes.list()).toEqual([])
  })

  test("a task with no desktop work is not reflected on at all", async () => {
    const seen: string[] = []
    const notes = await scratch()
    await reflector("topic: a\nfact: b", notes, seen).reflect("what is 2+2", [])
    expect(seen).toEqual([])
  })
})

describe("a reflection must only think", () => {
  test("the runner reports the session it created, so it can be marked", async () => {
    const { remoteRunner } = await import("../src/remote")
    const seen: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: any, init: any) => {
      const path = String(url)
      if (path.endsWith("/session")) return { ok: true, json: async () => ({ id: "ses_x" }) } as any
      return { ok: true, json: async () => ({ parts: [{ type: "text", text: "NOTHING" }] }) } as any
    }) as any
    try {
      const run = remoteRunner(new URL("http://127.0.0.1:1/"), (id) => seen.push(id))
      expect(await run("what did you learn?")).toBe("NOTHING")
      expect(seen).toEqual(["ses_x"])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("never making anybody wait", () => {
  test("a model that never answers does not hang the run", async () => {
    const notes = await scratch()
    const slow = new Reflector({
      notes,
      timeoutMs: 40,
      ask: () => new Promise<string>(() => {}), // never resolves
    })
    const started = Date.now()
    expect(await slow.reflect("x", ["ui_click"])).toEqual([])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("an answer that arrives in time is still kept", async () => {
    const notes = await scratch()
    const quick = new Reflector({
      notes,
      timeoutMs: 5000,
      ask: async () => "topic: editor\nfact: The text editor on this machine is Xed",
    })
    expect(await quick.reflect("x", ["app_open"])).toEqual(["editor"])
  })
})
