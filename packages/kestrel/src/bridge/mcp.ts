/**
 * A minimal MCP client over stdio.
 *
 * Kestrel's hands are not reimplemented in TypeScript. The X11, AT-SPI, OCR and
 * screen-capture layer is the hardest and most platform-specific part of this
 * problem, it already exists and is tested, and it speaks MCP over stdio. So we
 * speak MCP to it — one long-lived process, not one per call.
 *
 * This is deliberately small. It is not a general MCP client: it initializes,
 * lists tools once, and calls them. Anything it does not need, it does not have.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export type McpTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

type Pending = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const PROTOCOL = "2024-11-05"

/** Long enough for a screenshot on a loaded machine, short enough to notice a hang. */
const CALL_TIMEOUT = 120_000
const START_TIMEOUT = 60_000

export class McpBridge {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<number, Pending>()
  private buffer = ""
  private nextId = 1
  private starting?: Promise<void>
  private stderr = ""

  tools: McpTool[] = []
  instructions = ""

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string> = {},
  ) {}

  get running() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }

  /** Start once, however many callers ask at once. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = this.boot().catch((error) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  private async boot() {
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    })
    this.child = child

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(chunk))
    child.stderr.setEncoding("utf8")
    // Kept, not printed: the desktop layer writes progress here, and it is the
    // only evidence available when a start fails.
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    child.on("exit", (code) => this.fail(new Error(`desktop bridge exited (${code})\n${this.stderr}`)))
    child.on("error", (error) => this.fail(error as Error))

    const hello = await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "kestrel", version: "1" },
      },
      START_TIMEOUT,
    )
    this.instructions = String(hello?.instructions ?? "")
    this.notify("notifications/initialized")

    const listed = await this.request("tools/list", {}, START_TIMEOUT)
    this.tools = Array.isArray(listed?.tools) ? listed.tools : []
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.start()
    const result = await this.request("tools/call", { name, arguments: args }, CALL_TIMEOUT)
    const parts = Array.isArray(result?.content) ? result.content : []
    const text = parts
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part.text ?? ""))
      .join("\n")
    return { text, isError: Boolean(result?.isError) }
  }

  stop() {
    this.fail(new Error("desktop bridge stopped"))
    this.child?.kill("SIGTERM")
    this.child = undefined
    this.starting = undefined
  }

  // -- protocol ----------------------------------------------------------

  private request(method: string, params: unknown, timeout: number): Promise<any> {
    const id = this.nextId++
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(new Error(`desktop bridge timed out after ${Math.round(timeout / 1000)}s on ${method}`))
        },
        timeout,
      )
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.child!.stdin.write(line)
      } catch (error) {
        this.settle(id, () => reject(error as Error))
      }
    })
  }

  private notify(method: string, params: unknown = {}) {
    try {
      this.child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
    } catch {
      /* the exit handler will report it */
    }
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let cut: number
    while ((cut = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, cut).trim()
      this.buffer = this.buffer.slice(cut + 1)
      if (!line) continue
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        continue // the server prints a banner before the protocol starts
      }
      if (typeof message?.id !== "number") continue
      const id = message.id
      if (message.error) {
        this.settle(id, (p) => p.reject(new Error(message.error?.message ?? "bridge error")))
      } else {
        this.settle(id, (p) => p.resolve(message.result))
      }
    }
  }

  private settle(id: number, act: (pending: Pending) => void) {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    act(pending)
  }

  private fail(error: Error) {
    for (const [id] of this.pending) this.settle(id, (p) => p.reject(error))
  }
}
