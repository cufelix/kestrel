/**
 * Reaching the agent from a phone.
 *
 * The properties that matter: only the people on the list can drive the
 * computer, a reply too long for Telegram is split rather than refused, and
 * losing signal does not end the session.
 */

import { describe, expect, test } from "bun:test"
import { Telegram, allowList, split, type Update } from "../src/remote/telegram"

type Call = { method: string; body: any }

function bot(options: { allow?: string[]; run?: (task: string) => Promise<string> } = {}) {
  const calls: Call[] = []
  const replies: any[] = []
  const fake = (async (url: string, init: any) => {
    const method = String(url).split("/").pop()!
    calls.push({ method, body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => replies.shift() ?? { ok: true, result: [] },
    } as any
  }) as typeof globalThis.fetch

  const telegram = new Telegram({
    token: "test-token",
    allow: new Set(options.allow ?? ["42"]),
    run: options.run ?? (async (task) => `did: ${task}`),
    fetch: fake,
  })
  return { telegram, calls, replies }
}

function message(text: string, chatId: string | number = 42, id = 1): Update {
  return { update_id: id, message: { chat: { id: chatId }, text } }
}

describe("who may drive the computer", () => {
  test("a chat on the list is obeyed", async () => {
    const { telegram, calls } = bot()
    await telegram.handle(message("open the calculator"))
    const sent = calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text)
    expect(sent).toContain("did: open the calculator")
  })

  test("a chat that is not on the list is refused", async () => {
    const { telegram, calls } = bot({ allow: ["42"], run: async () => "should never run" })
    await telegram.handle(message("open the calculator", 999))
    const sent = calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text).join(" ")
    expect(sent).toContain("Not authorised")
    expect(sent).not.toContain("should never run")
  })

  test("the refusal names the id, so it can be added deliberately", async () => {
    const { telegram, calls } = bot({ allow: [] })
    await telegram.handle(message("hello", 12345))
    expect(calls.at(-1)!.body.text).toContain("12345")
  })

  test("an empty allowlist obeys nobody", async () => {
    let ran = false
    const { telegram } = bot({ allow: [], run: async () => ((ran = true), "x") })
    await telegram.handle(message("do something", 42))
    expect(ran).toBe(false)
  })
})

describe("conversation", () => {
  test("help explains what it is without running anything", async () => {
    let ran = false
    const { telegram, calls } = bot({ run: async () => ((ran = true), "x") })
    await telegram.handle(message("/help"))
    expect(ran).toBe(false)
    expect(calls.at(-1)!.body.text).toContain("use the computer")
  })

  test("it says it is working before it starts", async () => {
    const { telegram, calls } = bot()
    await telegram.handle(message("something slow"))
    expect(calls.filter((c) => c.method === "sendMessage")[0].body.text).toBe("Working…")
  })

  test("a failure is reported rather than swallowed", async () => {
    const { telegram, calls } = bot({
      run: async () => {
        throw new Error("the desktop is not there")
      },
    })
    await telegram.handle(message("do it"))
    expect(calls.at(-1)!.body.text).toContain("the desktop is not there")
  })

  test("an empty message is ignored", async () => {
    const { telegram, calls } = bot()
    await telegram.handle({ update_id: 1, message: { chat: { id: 42 }, text: "   " } })
    expect(calls).toHaveLength(0)
  })
})

describe("polling", () => {
  test("does not ask for the same update twice", async () => {
    const { telegram, calls, replies } = bot()
    replies.push({ ok: true, result: [message("one", 42, 7)] })
    await telegram.poll()
    replies.push({ ok: true, result: [] })
    await telegram.poll()
    expect(calls[1].body.offset).toBe(8)
  })

  test("an HTTP failure is an error, not a silent stall", async () => {
    const telegram = new Telegram({
      token: "t",
      allow: new Set(["42"]),
      run: async () => "",
      fetch: (async () => ({ ok: false, status: 502, json: async () => ({}) })) as any,
    })
    await expect(telegram.poll()).rejects.toThrow("502")
  })
})

describe("long replies", () => {
  test("are split rather than refused", () => {
    // Telegram rejects anything over 4096 characters, and a rejected reply
    // reads exactly like an agent that ignored you.
    const chunks = split("x".repeat(9000), 3900)
    expect(chunks.length).toBe(3)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(3900)
    expect(chunks.join("")).toHaveLength(9000)
  })

  test("break at a line when there is one", () => {
    const text = "a".repeat(3000) + "\n" + "b".repeat(3000)
    const [first] = split(text, 3900)
    expect(first.endsWith("a")).toBe(true)
  })

  test("a short reply is one message", () => {
    expect(split("hello", 3900)).toEqual(["hello"])
  })
})

describe("the allowlist", () => {
  test("reads ids however they were separated", () => {
    expect(allowList("1, 2 3,4")).toEqual(new Set(["1", "2", "3", "4"]))
  })

  test("unset means nobody", () => {
    expect(allowList(undefined)).toEqual(new Set())
    expect(allowList("  ")).toEqual(new Set())
  })
})
