/**
 * What Kestrel knows about this machine.
 *
 * The property that matters: a fact discovered once is there the next morning,
 * the same fact worded differently does not accumulate, and a note about
 * Firefox does not cost context on a task about spreadsheets.
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Notes, keywords } from "../src/brain/notes"

async function scratch() {
  return new Notes(await fs.mkdtemp(path.join(os.tmpdir(), "kestrel-notes-")))
}

describe("remembering", () => {
  test("a fact survives to the next session", async () => {
    const notes = await scratch()
    await notes.remember("text editor", "The text editor on this machine is Xed")

    const later = new Notes(notes.directory)
    const [note] = await later.list()
    expect(note.topic).toBe("text-editor")
    expect(note.body).toContain("Xed")
  })

  test("the same discovery worded differently is not filed twice", async () => {
    // This is how a journal becomes a log nobody reads.
    const notes = await scratch()
    expect((await notes.remember("editor", "The text editor on this machine is Xed")).added).toBe(true)
    expect((await notes.remember("editor", "the text editor here is xed")).added).toBe(false)

    const [note] = await notes.list()
    expect(note.body.split("\n").filter((line) => line.startsWith("-"))).toHaveLength(1)
  })

  test("a genuinely new fact about the same topic is added", async () => {
    const notes = await scratch()
    await notes.remember("editor", "The text editor is Xed")
    expect((await notes.remember("editor", "Xed asks for a filename on first save")).added).toBe(true)
    expect((await notes.list())[0].body.split("\n").filter((l) => l.startsWith("-"))).toHaveLength(2)
  })

  test("topics become filenames a person can open", async () => {
    const notes = await scratch()
    await notes.remember("Text Editor / GUI", "anything at all")
    const names = await fs.readdir(notes.directory)
    expect(names).toEqual(["text-editor-gui.md"])
  })

  test("an empty fact is not filed", async () => {
    const notes = await scratch()
    expect((await notes.remember("editor", "   ")).added).toBe(false)
    expect(await notes.list()).toEqual([])
  })

  test("forgetting removes it", async () => {
    const notes = await scratch()
    await notes.remember("editor", "The text editor is Xed")
    expect(await notes.forget("editor")).toBe(true)
    expect(await notes.list()).toEqual([])
    expect(await notes.forget("editor")).toBe(false)
  })
})

describe("recall", () => {
  test("brings back the note about what you are doing", async () => {
    const notes = await scratch()
    await notes.remember("calculator", "The calculator display is not in the accessibility tree")
    await notes.remember("firefox", "Firefox needs its own profile on the agent screen")
    await notes.remember("spreadsheet", "LibreOffice Calc takes eight seconds to start")

    const found = await notes.recall("open the calculator and add two numbers")
    expect(found.map((note) => note.topic)).toEqual(["calculator"])
  })

  test("a topic match outranks a passing mention", async () => {
    const notes = await scratch()
    await notes.remember("firefox", "Something about firefox")
    await notes.remember("calculator", "Do not use firefox for this")

    const found = await notes.recall("firefox")
    expect(found[0].topic).toBe("firefox")
  })

  test("nothing relevant means nothing is spent on it", async () => {
    const notes = await scratch()
    await notes.remember("calculator", "The calculator display is not in the accessibility tree")
    expect(await notes.recall("write a haskell parser")).toEqual([])
  })

  test("a task with no usable words falls back to what is most recent", async () => {
    const notes = await scratch()
    await notes.remember("one", "first fact")
    await notes.remember("two", "second fact")
    const found = await notes.recall("do it")
    expect(found.length).toBeGreaterThan(0)
  })

  test("an empty memory is not an error", async () => {
    const notes = await scratch()
    expect(await notes.recall("anything")).toEqual([])
    expect(await notes.list()).toEqual([])
  })

  test("a missing directory is not an error", async () => {
    const notes = new Notes("/nonexistent/kestrel/notes")
    expect(await notes.list()).toEqual([])
  })
})

describe("keywords", () => {
  test("drops words too common to choose between notes", () => {
    expect(keywords("open the calculator and work out the total")).not.toContain("the")
    expect(keywords("open the calculator")).toContain("calculator")
  })

  test("drops words too short to mean anything", () => {
    expect(keywords("do it now")).toEqual(new Set())
  })
})

describe("when two facts disagree", () => {
  test("the newer one is read first", async () => {
    // Judging which of two bullets is true needs semantics that would be wrong
    // more often than right. The most recent look at a desktop that changes is
    // a rule that can be stated and relied on.
    const notes = await scratch()
    await notes.remember("editor", "No window ever appears when opening the editor")
    await notes.remember("editor", "The editor opens and saves without trouble")

    const bullets = (await notes.list())[0].body.split("\n").filter((l) => l.startsWith("-"))
    expect(bullets[0]).toContain("opens and saves")
  })

  test("a note does not grow past what anybody reads", async () => {
    const { MAX_LESSONS } = await import("../src/brain/notes")
    const subjects = [
      "toolbar", "sidebar", "statusbar", "menubar", "gutter", "minimap",
      "breadcrumb", "terminal", "explorer", "palette", "tabstrip", "ruler",
      "outline", "problems", "timeline", "search", "debugger",
    ]
    const notes = await scratch()
    for (const subject of subjects) {
      await notes.remember("editor", `The ${subject} widget is exposed with its own accessible name`)
    }
    const bullets = (await notes.list())[0].body.split("\n").filter((l) => l.startsWith("-"))
    expect(bullets).toHaveLength(MAX_LESSONS)
    expect(bullets[0]).toContain(subjects[subjects.length - 1])
    expect(bullets.join(" ")).not.toContain(subjects[0])
  })
})
