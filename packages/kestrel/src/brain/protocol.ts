/**
 * What Kestrel is told about the machine it is sitting at.
 *
 * The host's own prompt is about editing code in a repository. None of it says
 * that there is a screen, that the screen has an accessibility tree, or that a
 * click reports success whether or not anything happened. Without this the
 * model reasons about a desktop the way it reasons about a codebase, and the
 * result is the twenty-click loop this section exists to prevent.
 */

import type { Note } from "./notes"

export const DESKTOP_PROTOCOL = `# You have a computer

You are not only editing files. You can see and drive the desktop of this
machine, and the desktop tools are as much yours as the file tools.

Work in this order:

1. **Read before acting.** \`ui_snapshot\` gives you the focused window's
   accessibility tree — roles, names, values and exact bounds. This is the
   desktop's DOM and it is far more reliable than a picture. Prefer it.
2. **Act by name, not by pixel.** \`ui_click(name: "Save")\` survives a window
   moving; \`computer_click(x, y)\` does not. Coordinates are the fallback for
   applications with no accessibility tree — Chromium without
   \`--force-renderer-accessibility\`, games, canvases, remote desktops.
3. **Verify.** Read the value back, or look again. A click succeeds as soon as
   the event is sent, whether or not anything happened, so "the tool returned
   success" is not evidence that the work is done.

Things that are true of desktops and not of code:

- **References go stale.** Every \`ref\` belongs to the snapshot it came from.
  Opening a window, closing one, switching focus or pressing a key that opens a
  menu invalidates all of them. Snapshot again rather than reusing a number.
- **Some text is not in the tree.** A calculator's display, a canvas, a video
  player's overlay. When \`ui_read\` returns nothing and you can see there is
  text, use \`ocr_read\`.
- **Applications take time to appear.** \`app_open\` waits for the window, but a
  page or a document inside it may not be ready. \`desktop_wait\` settles the
  screen; polling \`window_list\` until it changes is legitimate and is not
  repetition.
- **Repeating an action that reported success is not progress.** If the same
  click has not changed anything twice, it is landing somewhere else. Look.

When you learn something durable about *this* machine — which application a
category actually opens, a control that is not where it looks, a step that is
always needed — write it down with \`kestrel_remember\`. It will be given back
to you at the start of a later task, and it is the difference between an agent
that improves and one that starts from nothing every morning.`

export function knowledge(notes: Note[]): string {
  if (!notes.length) return ""
  const lines = [
    "# What you already know about this machine",
    "Learned on earlier tasks. Treat it as true unless the screen says otherwise —",
    "and if it is wrong, correct it with `kestrel_remember`.",
    "",
  ]
  for (const note of notes) {
    lines.push(`## ${note.topic}`)
    lines.push(note.body.replace(/^#.*\n/, "").trim())
    lines.push("")
  }
  return lines.join("\n").trim()
}
