/**
 * What Kestrel knows about *this* machine.
 *
 * A desktop agent works the same problem repeatedly on one computer, and almost
 * everything that goes wrong the first time is a fact about that computer: the
 * text editor is Xed, the calculator's display is not in the accessibility tree,
 * this application takes eight seconds to draw its first window. An agent that
 * rediscovers those every session is not learning, it is repeating.
 *
 * So they are written down as plain markdown, one file per topic, in a
 * directory the user can read and correct. Not a vector store: the corpus is a
 * few dozen short notes about one machine, the retrieval that matters is "does
 * this mention what I am about to do", and a person has to be able to open the
 * thing and cross out what is wrong.
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type Note = {
  topic: string
  body: string
  updated: number
}

/** A word this common says nothing about which note to pick. */
const COMMON = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "then", "when",
  "what", "your", "have", "will", "open", "make", "want", "need", "does", "just",
  "some", "them", "they", "there", "about", "which", "would", "could", "should",
])

export class Notes {
  constructor(readonly directory: string = defaultDirectory()) {}

  async list(): Promise<Note[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.directory)
    } catch {
      return []
    }
    const out: Note[] = []
    for (const name of names) {
      if (!name.endsWith(".md")) continue
      const file = path.join(this.directory, name)
      try {
        const [body, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)])
        out.push({ topic: name.slice(0, -3), body: body.trim(), updated: stat.mtimeMs })
      } catch {
        continue // an unreadable note must not empty the memory
      }
    }
    return out.sort((a, b) => b.updated - a.updated)
  }

  /**
   * Add a fact under a topic, merging rather than appending.
   *
   * Appending is how a journal becomes a log nobody reads: the same discovery,
   * worded five ways, five times. A fact already recorded is left alone.
   */
  async remember(topic: string, fact: string): Promise<{ topic: string; added: boolean }> {
    const slug = slugify(topic)
    const line = tidy(fact)
    if (!slug || !line) return { topic: slug, added: false }

    await fs.mkdir(this.directory, { recursive: true })
    const file = path.join(this.directory, `${slug}.md`)
    let existing = ""
    try {
      existing = await fs.readFile(file, "utf8")
    } catch {
      existing = `# ${topic.trim()}\n`
    }
    if (says(existing, line)) return { topic: slug, added: false }

    const body = existing.trimEnd() + `\n- ${line}\n`
    await write(file, body)
    return { topic: slug, added: true }
  }

  async forget(topic: string): Promise<boolean> {
    try {
      await fs.unlink(path.join(this.directory, `${slugify(topic)}.md`))
      return true
    } catch {
      return false
    }
  }

  /**
   * The notes worth putting in front of the model for this task, best first.
   *
   * Scored on rare words shared with the task. A note about Firefox is not
   * relevant to a task about spreadsheets, and spending the context on it costs
   * the same every turn.
   */
  async recall(task: string, limit = 6): Promise<Note[]> {
    const notes = await this.list()
    const terms = keywords(task)
    if (!terms.size) return notes.slice(0, limit)

    const scored = notes.map((note) => {
      const haystack = `${note.topic} ${note.body}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (note.topic.toLowerCase().includes(term)) score += 5
        else if (haystack.includes(term)) score += 1
      }
      return { note, score }
    })
    const matched = scored.filter((entry) => entry.score > 0)
    matched.sort((a, b) => b.score - a.score || b.note.updated - a.note.updated)
    return matched.slice(0, limit).map((entry) => entry.note)
  }
}

export function defaultDirectory(): string {
  return process.env.KESTREL_NOTES || path.join(os.homedir(), ".kestrel", "notes")
}

export function keywords(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3 && !COMMON.has(word)),
  )
}

function slugify(topic: string): string {
  return (topic ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

function tidy(fact: string): string {
  return (fact ?? "").trim().replace(/\s+/g, " ").replace(/^[-*]\s*/, "").slice(0, 400)
}

/**
 * Whether this note already says the same thing, allowing for wording.
 *
 * Uses a shorter word floor than recall does. Recall drops three-letter words
 * because they are noise across a whole corpus; here they are frequently the
 * whole point — "the editor is Xed" and "the editor here is xed" differ in
 * exactly the word that matters.
 */
const SAME_ENOUGH = 0.6

function says(body: string, line: string): boolean {
  const wanted = significant(line)
  if (wanted.size < 2) return body.toLowerCase().includes(line.toLowerCase())
  for (const existing of body.split("\n")) {
    if (!existing.trim().startsWith("-")) continue
    const have = significant(existing)
    let shared = 0
    for (const word of wanted) if (have.has(word)) shared++
    if (shared >= 2 && shared / wanted.size >= SAME_ENOUGH) return true
  }
  return false
}

function significant(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2 && !COMMON.has(word)),
  )
}

/** Write through a temporary file: a crash must not truncate somebody's notes. */
async function write(file: string, body: string) {
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, body, "utf8")
  await fs.rename(temporary, file)
}
