# Kestrel — an autonomous desktop agent that learns

A fork of [opencode](https://github.com/sst/opencode) (MIT) whose brain stays
opencode's — a mature agent loop, provider handling, TUI, server and web
interface — with the parts it does not have added: hands, a desktop of its own,
a memory that survives the session, and a way to reach it from a phone.

## Why a fork rather than a new agent

Everything an agent needs that is *not* about desktops, opencode already does
well and has done for longer: streaming, tool calling, provider failover,
sessions, permissions, compaction, an SDK and a server. Rewriting that is how
projects die. What opencode has never had is a body.

## Why a fork rather than an MCP server

Bolting the desktop tools on over MCP works — it is one config entry, and it
answers "can opencode use a computer" with yes. Measured on the same task and
model, opencode-plus-MCP took 18 tool calls where an agent built for desktops
took 7. The gap is not the tools; they were the same tools. It is loop
behaviour that MCP cannot carry:

- re-reading the accessibility tree after it changes rather than reusing stale
  references
- refusing an action that has already failed the same way three times
- standing aside while the human is using the mouse
- working on a screen of its own so it never has to
- reading the pixels aloud when the model turns out to have no vision

Those live in the *loop*. A fork can put them there. A plugin cannot be added
to somebody else's release.

## Architecture

    packages/kestrel/          first-party plugin, shipped with the fork
      tools/desktop.ts         the hands
      brain/recall.ts          what it knows about this machine
      brain/reflect.ts         what it learned this run
      brain/discipline.ts      repetition guard, protocol, yielding
      bridge/                  talks to the desktop layer

The hands themselves are not reimplemented. The X11/AT-SPI/OCR layer is the
hardest and most platform-specific part of this problem and it already exists,
tested, in Python. Kestrel drives it over a local bridge and ships it as one
product — the user installs one thing.

## v1

- [ ] fork builds and runs under its own name
- [ ] desktop tools registered natively, so the model sees them as its own
- [ ] learning: notes recalled into the prompt, written back after a run
- [ ] loop discipline: repetition guard and the desktop protocol
- [ ] a desktop of its own, with handover when the task ends
- [ ] web interface
- [ ] Telegram
- [ ] one-line install, README, tests

## Non-goals for v1

- Reimplementing X11 or AT-SPI in TypeScript.
- Diverging from upstream where there is no reason to. Every change should be
  additive so upstream can still be merged.
