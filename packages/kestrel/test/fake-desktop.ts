/** A desktop layer that is entirely made up, for testing the bridge. */
const tools = [
  {
    name: "window_list",
    description: "List windows",
    inputSchema: { type: "object", properties: { match: { type: "string", description: "filter" } } },
  },
  {
    name: "ui_click",
    description: "Click something",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "integer" },
        name: { type: "string" },
        button: { type: "string", enum: ["left", "right"] },
      },
      required: ["ref"],
    },
  },
  { name: "file_read", description: "Read a file", inputSchema: { type: "object", properties: {} } },
]

process.stderr.write("fake-desktop: ready\n")
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffer += chunk
  let cut: number
  while ((cut = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const reply = (result: unknown) =>
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n")

    if (message.method === "initialize") reply({ instructions: "made up instructions", capabilities: {} })
    if (message.method === "tools/list") reply({ tools })
    if (message.method === "tools/call") {
      const { name, arguments: args } = message.params
      if (name === "explode") {
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: "it exploded" } }) + "\n",
        )
        continue
      }
      reply({
        content: [{ type: "text", text: `${name} called with ${JSON.stringify(args)}` }],
        isError: name === "fails",
      })
    }
  }
})
