/**
 * The hands.
 *
 * These are registered as first-party tools, not as an MCP server the model is
 * told about — the difference matters. A tool the agent owns can have its
 * description written for *this* agent, can be withheld when it is not wanted,
 * and can be wrapped in the discipline that makes desktop work reliable. A tool
 * borrowed over MCP is whatever the other end says it is.
 *
 * What is deliberately not exposed: everything the host is already better at.
 * Reading files, writing files, running shell commands and delegating to a
 * coding model are opencode's own tools and they are more capable than the
 * desktop layer's versions. Offering both would spend context describing two
 * ways to do one thing, and invite the model to pick the worse one.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { McpBridge, type McpTool } from "./bridge/mcp"

/** The desktop tools worth having, in the order they are usually reached for. */
export const EXPOSED = [
  // seeing
  "ui_snapshot", "ui_find", "ui_read", "desktop_observe",
  "computer_screenshot", "ocr_read", "ocr_find",
  "window_list", "computer_cursor", "user_idle", "notifications_recent",
  // acting
  "app_open", "app_list", "app_close",
  "ui_click", "ui_type", "ui_focus", "ui_wait_for",
  "computer_click", "computer_type", "computer_key",
  "computer_move", "computer_drag", "computer_scroll",
  "window_focus", "window_close", "window_arrange",
  "workspace_list", "workspace_switch", "window_to_workspace",
  "clipboard_read", "clipboard_write",
  "desktop_wait", "notify_user",
] as const

const HIDDEN_REASON: Record<string, string> = {
  file_read: "opencode reads files",
  file_write: "opencode writes files",
  file_list: "opencode globs",
  shell_exec: "opencode runs the shell",
  code_agent: "opencode is the coding agent",
  delegate: "opencode has subagents",
}

let bridge: McpBridge | undefined

/**
 * How to start the desktop layer.
 *
 * `KESTREL_DESKTOP` may be a bare program, in which case the standard
 * arguments are added, or a whole command line, in which case it is taken as
 * given — which is how a different desktop server, or a fake one, is pointed at.
 */
export function desktopCommand(): { command: string; args: string[] } {
  const configured = (process.env.KESTREL_DESKTOP || "lai").trim()
  const words = configured.split(/\s+/).filter(Boolean)
  const command = words[0] || "lai"
  if (words.length > 1) return { command, args: words.slice(1) }
  return { command, args: ["mcp", "--no-mcp", ...screenArgs()] }
}

export function desktop(): McpBridge {
  if (!bridge) {
    const { command, args } = desktopCommand()
    bridge = new McpBridge(command, args, {
      // An MCP client cannot answer an interactive approval prompt, so the
      // desktop layer must not ask for one.
      LAI_MODE: process.env.KESTREL_MODE || "auto",
    })
  }
  return bridge
}

/** For tests, which need a fresh bridge per command. */
export function resetDesktop() {
  bridge?.stop()
  bridge = undefined
}

function screenArgs(): string[] {
  const where = (process.env.KESTREL_SCREEN || "own").toLowerCase()
  if (where === "here" || where === "yours") return ["--here"]
  if (where === "hidden" || where === "unwatched") return ["--unwatched"]
  return ["--watch"]
}

/** JSON Schema from the desktop layer, as the zod shape a tool wants. */
function shape(mcp: McpTool): Record<string, any> {
  const schema = (mcp.inputSchema ?? {}) as any
  const properties = (schema.properties ?? {}) as Record<string, any>
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const out: Record<string, any> = {}
  for (const [name, spec] of Object.entries(properties)) {
    let field = fromJsonSchema(spec)
    if (spec?.description) field = field.describe(String(spec.description))
    out[name] = required.has(name) ? field : field.optional()
  }
  return out
}

function fromJsonSchema(spec: any): any {
  const z = tool.schema
  switch (spec?.type) {
    case "string":
      return Array.isArray(spec.enum) && spec.enum.length ? z.enum(spec.enum as [string, ...string[]]) : z.string()
    case "integer":
    case "number":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(spec.items ? fromJsonSchema(spec.items) : z.any())
    case "object":
      return z.object({}).passthrough()
    default:
      return z.any()
  }
}

/**
 * Build the tool table. Requires the bridge to be up, because the schemas come
 * from it — the desktop layer is the authority on what its tools take, and
 * copying that into TypeScript would be two things to keep in step.
 */
export async function desktopTools(): Promise<Record<string, ToolDefinition>> {
  const hands = desktop()
  await hands.start()

  const wanted = new Set<string>(EXPOSED)
  const table: Record<string, ToolDefinition> = {}

  for (const mcp of hands.tools) {
    if (!wanted.has(mcp.name)) continue
    table[mcp.name] = tool({
      description: mcp.description ?? mcp.name,
      args: shape(mcp),
      async execute(args) {
        const clean = Object.fromEntries(Object.entries(args ?? {}).filter(([, v]) => v !== undefined))
        const result = await hands.call(mcp.name, clean)
        if (result.isError) throw new Error(result.text || `${mcp.name} failed`)
        return result.text || "(no output)"
      },
    })
  }
  return table
}

export function hiddenReason(name: string): string | undefined {
  return HIDDEN_REASON[name]
}
