/**
 * Kestrel — an autonomous desktop agent that learns.
 *
 * A first-party plugin, not an add-on: it ships inside the fork and loads by
 * default. Everything here is additive, so upstream opencode can still be
 * merged.
 *
 * Three things the host does not have:
 *   hands        the desktop, as first-party tools
 *   memory       what it learned about this machine, recalled and written back
 *   discipline   the loop behaviour that makes desktop work reliable
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { desktopTools } from "./desktop"
import { Notes } from "./brain/notes"
import { Discipline } from "./brain/discipline"
import { DESKTOP_PROTOCOL, knowledge } from "./brain/protocol"
import { Reflector } from "./brain/reflect"
import { remoteRunner, startRemotes } from "./remote"

export const Kestrel: Plugin = async (input) => {
  const notes = new Notes()
  const discipline = new Discipline()

  // The desktop layer may not be installed. That is a reason to run without
  // hands and say so, not a reason to fail to start.
  let hands: Awaited<ReturnType<typeof desktopTools>> = {}
  let handsError = ""
  try {
    hands = await desktopTools()
  } catch (error) {
    handsError = error instanceof Error ? error.message : String(error)
  }

  /** The task being worked on, for deciding which notes are worth recalling. */
  let task = ""
  /** What this run has actually touched, for deciding whether it taught anything. */
  let used: string[] = []

  // Learning without being asked. A `remember` tool the model may call is a
  // memory it has to remember to use, which it does when prompted and forgets
  // when it is busy finishing the task.
  // A reflection runs as a session like any other, which means it is handed
  // the same hands. Asked what it learned, an agent holding a mouse is capable
  // of going and checking. These are the sessions that must only think.
  const thinkingOnly = new Set<string>()
  const reflector = new Reflector({
    notes,
    ask: (prompt) => remoteRunner(input.serverUrl, (id) => thinkingOnly.add(id))(prompt),
  })
  let reflecting = false

  // Reachable from a phone, when a token has been set. An agent that runs your
  // computer is most useful when you are not sitting at it.
  const stopRemotes = startRemotes(input.serverUrl, (message) => console.error(`kestrel: ${message}`))

  const guarded = Object.fromEntries(
    Object.entries(hands).map(([name, definition]) => [
      name,
      tool({
        description: definition.description,
        args: definition.args,
        async execute(args, context) {
          if (thinkingOnly.has(context.sessionID)) {
            return (
              `Refused: ${name} is not available here. This is a reflection — you are ` +
              `being asked what an earlier task taught about this machine, not to go ` +
              `and find out. Answer from what you were told.`
            )
          }
          const verdict = discipline.before(name, args as Record<string, unknown>)
          if (!verdict.allow) return verdict.reason
          try {
            const output = await definition.execute(args, context)
            const text = typeof output === "string" ? output : output.output
            return text + discipline.after(name, args as Record<string, unknown>, true)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const note = discipline.after(name, args as Record<string, unknown>, false)
            throw new Error(message + note)
          }
        },
      }),
    ]),
  )

  return {
    async dispose() {
      stopRemotes()
    },

    tool: {
      ...guarded,

      kestrel_remember: tool({
        description:
          "Write down something durable you learned about THIS MACHINE, so a later task " +
          "starts knowing it.\n\n" +
          "Worth remembering — still true next week, saves a later task from " +
          "rediscovering it:\n" +
          "  · \"The text editor is Xed; app_open 'Text Editor' opens it\"\n" +
          "  · \"The calculator's display is not in the accessibility tree — read it " +
          "with ocr_read\"\n" +
          "  · \"LibreOffice takes about eight seconds before its window is usable\"\n\n" +
          "Not worth remembering — the answer to the task you were just given, not a " +
          "fact about the machine:\n" +
          "  · \"45 + 78 = 123\"  (arithmetic, not this computer)\n" +
          "  · \"The calculator works\"  (says nothing a later task can use)\n" +
          "  · \"I opened Firefox successfully\"  (an event, not a fact)\n\n" +
          "If you cannot say how a later task would be faster for knowing it, do not " +
          "write it down.",
        args: {
          topic: tool.schema
            .string()
            .describe("A short subject, e.g. 'calculator' or 'text editor'"),
          fact: tool.schema.string().describe("One sentence, stated as fact"),
        },
        async execute(args) {
          const result = await notes.remember(args.topic, args.fact)
          return result.added
            ? `Remembered under “${result.topic}”.`
            : `Already known under “${result.topic}” — nothing added.`
        },
      }),

      kestrel_recall: tool({
        description:
          "Look up what is already known about this machine. Relevant notes are given to " +
          "you automatically at the start of a task; use this to search for more.",
        args: { query: tool.schema.string().optional().describe("What you are looking for") },
        async execute(args) {
          const found = args.query ? await notes.recall(args.query, 10) : await notes.list()
          if (!found.length) return "Nothing has been learned about this machine yet."
          return found.map((note) => `## ${note.topic}\n${note.body}`).join("\n\n")
        },
      }),
    },

    async event({ event }) {
      // Set KESTREL_TRACE=1 to see which events actually arrive. "the hook was
      // never called" and "the hook did nothing" look identical from outside.
      if (process.env.KESTREL_TRACE) {
        console.error(`kestrel-trace: event ${(event as any)?.type} (used=${used.length})`)
      }
      // The end of a task is the moment to notice what it taught. Once, and
      // never while another reflection is in flight — a reflection is itself a
      // session, and its own idle event would start another.
      if ((event as any)?.type !== "session.idle") return
      if (reflecting || !used.length) return
      reflecting = true
      const about = task
      const withTools = used
      used = []

      // Not awaited. A one-shot `kestrel run` would otherwise sit there after
      // the answer is already on screen, waiting for a lesson nobody asked
      // for. In a server or the terminal interface the reflection finishes on
      // its own; in a one-shot run it may be cut off when the process exits,
      // and that is the right way round — the task is what was being waited on.
      void (async () => {
        try {
          const learned = await reflector.reflect(about, withTools)
          if (learned.length) console.error(`kestrel: learned about ${learned.join(", ")}`)
        } catch {
          /* losing a lesson must never fail the run it came from */
        } finally {
          reflecting = false
          // Bounded: a long-lived server would otherwise accumulate one id per
          // task for as long as it runs.
          if (thinkingOnly.size > 50) thinkingOnly.clear()
        }
      })()
    },

    async "tool.execute.after"({ tool }) {
      used.push(tool)
      if (process.env.KESTREL_TRACE) console.error(`kestrel-trace: after ${tool} (used=${used.length})`)
    },

    async "chat.message"(_input, output) {
      const said = output.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => String(part.text ?? ""))
        .join(" ")
      if (said.trim()) task = said.trim().slice(0, 600)
    },

    async "experimental.chat.system.transform"(_input, output) {
      // A way to prove the prompt actually reaches the model. Injection is
      // invisible from the outside, and "the instruction was ignored" and "the
      // instruction was never sent" look identical until you can tell them
      // apart. Ask it to repeat the marker.
      if (process.env.KESTREL_PROMPT_PROBE) output.system.push(`PROBE-MARKER-${process.env.KESTREL_PROMPT_PROBE}`)
      if (handsError) {
        // Deliberately *not* the desktop protocol. It describes ui_snapshot,
        // ui_click and the rest at length, and describing tools that are not
        // there is how a model ends up calling one and being told it does not
        // exist — which it then works around by guessing at shell commands.
        output.system.push(
          `# There is no desktop\n` +
            `The tools that drive this machine's screen could not be started: ${handsError}\n` +
            `You have no way to see or touch the screen. If you are asked to do something ` +
            `on the desktop, say plainly that the desktop layer is not available and that ` +
            `it is installed with:\n` +
            `    pipx install 'lai[tui,mcp] @ git+https://github.com/cufelix/lai.git'\n` +
            `Do not attempt it with shell commands instead.`,
        )
        return
      }
      output.system.push(DESKTOP_PROTOCOL)
      const recalled = await notes.recall(task)
      const learned = knowledge(recalled)
      if (learned) output.system.push(learned)
    },
  }
}

export default Kestrel
