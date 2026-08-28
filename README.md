# Kestrel

**An autonomous desktop agent that learns.**

Kestrel is a fork of [opencode](https://github.com/sst/opencode) that gives it a
body. It keeps opencode's brain — the agent loop, provider handling, sessions,
permissions, compaction, the terminal interface and the server — and adds the
three things it has never had: hands, a memory of the machine it lives on, and
the loop discipline that makes driving a desktop reliable rather than
approximate.

```
> open the calculator and work out 45 + 78, then tell me what the display shows

⚙ app_open      Calculator
⚙ ui_snapshot   Calculator
⚙ ui_click      4   5   +   7   8   =
⚙ ui_read       ref 87
The display shows 45+78 and the result 123.
⚙ kestrel_remember   calculator
```

The last line is the point. Tomorrow it starts already knowing.

---

## Why a fork

Everything an agent needs that is *not* about desktops, opencode already does
well and has done for longer: streaming, tool calling, provider failover,
sessions, permissions, compaction, an SDK, a server, a TUI. Rewriting that is
how projects die.

And the desktop tools *can* be bolted on from outside, over MCP — it is one
config entry. Measured on the same task with the same model, opencode driving
those tools over MCP took **18 tool calls**; an agent built for desktops took
**7**. Both got the right answer. The tools were identical.

The whole gap was loop behaviour, and none of it can be shipped as a tool:

- re-reading the accessibility tree after it changes, instead of reusing
  references from a snapshot that is no longer true
- refusing an action that has already failed the same way three times
- refusing an action that has reported success six times and changed nothing —
  a click succeeds as soon as the event is sent, whether or not it landed
- working on a screen of its own, so it never has to take your mouse

That lives in the loop. A plugin cannot be added to somebody else's release,
which is the reason this is a fork rather than an extension.

---

## Install

```bash
git clone https://github.com/cufelix/kestrel.git
cd kestrel
./install.sh
```

You need [bun](https://bun.sh). The hands are a separate Python package,
because X11, AT-SPI, OCR and virtual displays are the most platform-specific
part of this problem and reimplementing them in TypeScript would be months of
work to arrive back where we started:

```bash
pipx install 'lai[tui,mcp] @ git+https://github.com/cufelix/lai.git'
```

Kestrel finds it automatically. Without it, Kestrel still runs — it simply says
it has no hands when you ask it to do something on screen.

Because the hands are shared rather than reimplemented, an improvement there
arrives here without a line of code. Measured after one such fix: VS Code went
from **1** accessible element to **69**, because Chromium exposes nothing at
all to AT-SPI without `--force-renderer-accessibility` and nothing had ever
passed it.

---

## Use

```bash
kestrel                                   # talk to it
kestrel run "close everything on my second monitor"
kestrel serve                             # the same agent over HTTP
```

### A desktop of its own

By default Kestrel starts its own X server and works there. Applications it
opens live on that screen, and nothing it does reaches your keyboard, your
clipboard or your window stack. You keep working; so does it.

```bash
KESTREL_SCREEN=own       # its own screen, in a window you can watch (default)
KESTREL_SCREEN=hidden    # its own screen, entirely off-screen
KESTREL_SCREEN=here      # your desktop — for tasks about the windows you have open
```

### What it learns

Facts about *this* machine go into `~/.kestrel/notes/` as plain markdown, one
file per topic. Not a vector store: the corpus is a few dozen short notes about
one computer, and a person has to be able to open the thing and cross out what
is wrong.

```
~/.kestrel/notes/calculator.md
  # calculator
  - The display is not exposed in the accessibility tree; read it with ocr_read
  - Digit buttons are reachable by name, not by a stable ref
```

Relevant notes are put in front of the model at the start of a task, chosen by
rarity-weighted keyword match against what you asked for. A note about Firefox
does not cost context on a task about spreadsheets. The same discovery worded
five different ways is filed once.

### From a phone

```bash
export KESTREL_TELEGRAM_TOKEN=...      # from @BotFather
export KESTREL_TELEGRAM_ALLOW=123456   # your chat id, and nobody else's
kestrel serve
```

Long polling, not webhooks: this runs on a laptop, and a webhook would need a
public address and a port forwarded through somebody's router. Access is a list
of chat ids, because there is no useful middle ground between "may drive my
computer" and "may not".

---

## What it is made of

```
packages/kestrel/
  src/desktop.ts          which hands the model gets, and in what shape
  src/bridge/mcp.ts       one long-lived connection to the desktop layer
  src/brain/notes.ts      what it knows about this machine
  src/brain/discipline.ts the part that is about desktops rather than tools
  src/brain/protocol.ts   what it is told about having a screen
  src/remote/telegram.ts  reaching it from a phone
```

Thirty-four desktop tools are registered as first-party tools, not offered over
MCP. The difference matters: a tool the agent owns can have its description
written for *this* agent, can be wrapped in discipline, and can be withheld.
Deliberately excluded are the desktop layer's own file, shell and coding tools —
opencode's are better, and offering both spends context describing two ways to
do one thing and invites the model to pick the worse one.

Everything is additive. `packages/opencode` is changed by exactly one import and
one line, so upstream opencode can still be merged.

```bash
cd packages/kestrel && bun test
```

---

## Configuration

| | |
|---|---|
| `KESTREL_SCREEN` | `own` · `hidden` · `here` |
| `KESTREL_DESKTOP` | path to the desktop layer, or a whole command line |
| `KESTREL_NOTES` | where the memory lives (default `~/.kestrel/notes`) |
| `KESTREL_MODE` | permission mode passed to the desktop layer |
| `KESTREL_TELEGRAM_TOKEN` | bot token |
| `KESTREL_TELEGRAM_ALLOW` | chat ids allowed to give orders |

---

## Licence

MIT, as opencode is. See [LICENSE](LICENSE) — the original copyright stands.
