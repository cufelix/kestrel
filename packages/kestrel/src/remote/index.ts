/**
 * Starting the remote connectors, if they have been configured.
 *
 * Running a task from a phone means running it the same way the terminal does,
 * through the server this plugin is already inside — not a second, parallel
 * path that will drift.
 */

import { Telegram, allowList } from "./telegram"

export type Runner = (task: string) => Promise<string>

export function remoteRunner(serverUrl: URL): Runner {
  return async (task: string) => {
    const created = await fetch(new URL("/session", serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    if (!created.ok) throw new Error(`could not start a session: HTTP ${created.status}`)
    const session = (await created.json()) as { id?: string }
    if (!session.id) throw new Error("the server did not return a session")

    const answered = await fetch(new URL(`/session/${session.id}/message`, serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: task }] }),
    })
    if (!answered.ok) throw new Error(`the task failed: HTTP ${answered.status}`)
    const message = (await answered.json()) as { parts?: Array<{ type?: string; text?: string }> }
    return (message.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => String(part.text ?? ""))
      .join("\n")
      .trim()
  }
}

export function startRemotes(serverUrl: URL, log: (message: string) => void): () => void {
  const stops: Array<() => void> = []

  const token = process.env.KESTREL_TELEGRAM_TOKEN
  if (token) {
    const allow = allowList(process.env.KESTREL_TELEGRAM_ALLOW)
    if (!allow.size) {
      log("telegram: a token is set but KESTREL_TELEGRAM_ALLOW is empty, so nobody may use it")
    }
    const telegram = new Telegram({ token, allow, run: remoteRunner(serverUrl), log })
    void telegram.listen()
    stops.push(() => telegram.stop())
  }

  return () => stops.forEach((stop) => stop())
}
