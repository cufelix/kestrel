/**
 * Which hands the model is given, and in what shape.
 *
 * Two decisions are under test. The desktop layer's file, shell and coding
 * tools are deliberately not exposed — opencode's own are better, and offering
 * both spends context describing two ways to do one thing and invites the model
 * to pick the worse one. And the argument schemas come from the far end rather
 * than being copied into TypeScript, because two copies is two things to keep
 * in step.
 */

import { afterAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { EXPOSED, desktopTools, hiddenReason, resetDesktop } from "../src/desktop"

const FAKE = path.join(import.meta.dir, "fake-desktop.ts")

process.env.KESTREL_DESKTOP = `bun run ${FAKE}`
afterAll(() => resetDesktop())

describe("what is exposed", () => {
  test("the desktop tools are offered", () => {
    expect(EXPOSED).toContain("ui_snapshot")
    expect(EXPOSED).toContain("ui_click")
    expect(EXPOSED).toContain("computer_screenshot")
    expect(EXPOSED).toContain("ocr_read")
  })

  test("nothing the host already does better is offered twice", () => {
    for (const duplicate of ["file_read", "file_write", "shell_exec", "code_agent", "delegate"]) {
      expect(EXPOSED).not.toContain(duplicate as any)
      expect(hiddenReason(duplicate)).toBeTruthy()
    }
  })

  test("every exposed name is unique", () => {
    expect(new Set(EXPOSED).size).toBe(EXPOSED.length)
  })
})

describe("schemas", () => {
  test("come from the desktop layer, not from a copy", async () => {
    const table = await desktopTools()
    const click = table["ui_click"]
    expect(click).toBeTruthy()
    expect(Object.keys(click.args).sort()).toEqual(["button", "name", "ref"])
  })

  test("a required argument is required and the rest are not", async () => {
    const table = await desktopTools()
    const args = table["ui_click"].args as Record<string, any>
    expect(args.ref.isOptional?.() ?? args.ref._def?.typeName === "ZodOptional").toBeFalsy()
    expect(args.name.isOptional?.() ?? true).toBeTruthy()
  })

  test("a tool the far end does not have is simply absent", async () => {
    const table = await desktopTools()
    expect(table["ocr_read"]).toBeUndefined()
    expect(table["window_list"]).toBeTruthy()
  })

  test("what the host does better is filtered out even when offered", async () => {
    const table = await desktopTools()
    expect(table["file_read"]).toBeUndefined()
  })
})
