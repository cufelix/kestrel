/**
 * Reaching the agent from a phone.
 *
 * An agent that runs your computer is most useful when you are not at it —
 * "did that download finish", "close the thing I left open", "put the file on
 * the desktop". A chat app is the interface most people already have on the
 * device they are holding.
 *
 * Long polling rather than webhooks on purpose: a webhook needs a public
 * address, a certificate and a port forwarded through somebody's router, and
 * the whole point is that this runs on a laptop at home.
 *
 * Access is a list of chat ids and nothing else. There is no useful middle
 * ground between "this person may drive my computer" and "may not", and
 * anything cleverer would be a way to get that wrong quietly.
 */

const API = "https://api.telegram.org"

/** Telegram holds the request open; this is their limit, not ours. */
const POLL_SECONDS = 25

export type TelegramOptions = {
  token: string
  /** Chat ids allowed to give orders. Empty means nobody, which is the safe default. */
  allow: Set<string>
  /** Runs a task and resolves with what to say back. */
  run: (task: string, chatId: string) => Promise<string>
  fetch?: typeof globalThis.fetch
  log?: (message: string) => void
}

export type Update = {
  update_id: number
  message?: { chat?: { id?: number | string }; text?: string; from?: { username?: string } }
}

export class Telegram {
  private offset = 0
  private stopped = false
  private readonly http: typeof globalThis.fetch
  private readonly log: (message: string) => void

  constructor(private readonly options: TelegramOptions) {
    this.http = options.fetch ?? globalThis.fetch
    this.log = options.log ?? (() => {})
  }

  /** Poll until stopped. Never throws: a phone going out of signal is not fatal. */
  async listen(): Promise<void> {
    this.log("telegram: listening")
    while (!this.stopped) {
      try {
        const updates = await this.poll()
        for (const update of updates) await this.handle(update)
      } catch (error) {
        this.log(`telegram: ${error instanceof Error ? error.message : String(error)}`)
        await pause(3000)
      }
    }
  }

  stop() {
    this.stopped = true
  }

  async poll(): Promise<Update[]> {
    const body = { offset: this.offset || undefined, timeout: POLL_SECONDS, allowed_updates: ["message"] }
    const payload = await this.call("getUpdates", body)
    const updates: Update[] = Array.isArray(payload?.result) ? payload.result : []
    for (const update of updates) this.offset = Math.max(this.offset, update.update_id + 1)
    return updates
  }

  async handle(update: Update): Promise<void> {
    const chatId = String(update.message?.chat?.id ?? "")
    const text = (update.message?.text ?? "").trim()
    if (!chatId || !text) return

    if (!this.options.allow.has(chatId)) {
      // Say who is knocking, so the owner can add them deliberately. Saying
      // nothing at all makes a misconfigured allowlist look like a broken bot.
      this.log(`telegram: refused chat ${chatId}`)
      await this.send(chatId, `Not authorised. Add ${chatId} to KESTREL_TELEGRAM_ALLOW to use this.`)
      return
    }

    if (text === "/start" || text === "/help") {
      await this.send(chatId, HELP)
      return
    }

    await this.send(chatId, "Working…")
    try {
      const answer = await this.options.run(text, chatId)
      await this.send(chatId, answer || "(no reply)")
    } catch (error) {
      await this.send(chatId, `Failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    // Telegram refuses anything over 4096 characters, and a refused reply
    // reads exactly like an agent that ignored you.
    for (const chunk of split(text, 3900)) {
      await this.call("sendMessage", { chat_id: chatId, text: chunk })
    }
  }

  private async call(method: string, body: unknown): Promise<any> {
    const response = await this.http(`${API}/bot${this.options.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`telegram ${method}: HTTP ${response.status}`)
    return await response.json()
  }
}

const HELP = `Kestrel — I can use the computer this is running on.

Say what you want done, in plain words:
  what windows are open?
  open the calculator and work out 45 * 12
  take a screenshot and tell me what is on screen

I work on a desktop of my own, so nothing I do disturbs whoever is at the
machine.`

export function split(text: string, limit: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    // Break at a line if there is one, so a message never splits mid-sentence.
    const cut = rest.lastIndexOf("\n", limit)
    const at = cut > limit / 2 ? cut : limit
    out.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n/, "")
  }
  if (rest) out.push(rest)
  return out
}

export function allowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
