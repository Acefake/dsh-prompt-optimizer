# @local/prompt-optimizer

A DeepSeek Harness Web UI plugin that rewrites the composer draft into a clearer prompt with
one of the configured models, grounded in the current project and the recent conversation.

## What it adds

- A sparkle button at the **left end of the composer tool row**, immediately left of the model
  selector, in every session where the composer renders.
- A review dialog (frame-wide overlay) with a model picker, the original draft, and an editable
  result. Nothing is written back until the person chooses **Replace draft** or **Insert at
  cursor**; Escape, the backdrop, or Cancel discards the result.
- **Streaming preview**: the dialog shows the rewritten text while the model generates it, and
  Cancel aborts the in-flight request.
- **Original / rewrite / compare tabs**: inspect the draft, the rewrite, or both side by side
  before writing anything back.
- **Session model by default**: the dialog starts on the model the composer's own model selector
  has selected for this session (`ctx.modelDirectories`), falling back to the last choice on this
  device, then the deployment default.
- **Keyboard chord**: `Ctrl+Shift+U` (`⌘⇧U` on macOS) opens the dialog for the current draft.
  The command registers through `ctx.shortcuts`, so it also appears in Settings → Shortcuts and
  honours user keybinding overrides; if the service or binding is unavailable the button still
  works.
- **In-dialog submit**: `Ctrl+Enter` (`⌘↵`) starts the rewrite, or applies **Replace draft** once
  a result exists.

## How it stays grounded

The Host half builds one small context envelope per request:

- the Session working directory and a shallow project brief (`package.json` identity and script
  names, top-level entry names, `.git/HEAD` branch) read read-only from disk;
- the latest user/assistant text of the Session (bounded, read through
  `ctx.sessionController.inspect()` without activating an Agent);
- the composer draft itself.

The system instruction forbids inventing requirements, files, APIs, constraints, or facts, keeps
missing information as explicit open questions, preserves the draft's language and intent, and
returns only the rewritten prompt. A draft in Chinese comes back in Chinese.

## Architecture

| File | Half | Role |
|---|---|---|
| `index.js` | Host | Registers three loopback-only JSON routes on the Harness web server, lists the model catalog, calls `ctx.llm.prepareCall()` / `stream()`, builds the grounded context |
| `client.js` | Web | Registers the composer button in `conversation.input.left` and the dialog in `shell.overlay`, reads the draft with `useInput`, writes back with `inputActions.setDraft()` / `insertText()` |
| `cordis.patch.yml` | Bundle | Inserts the `prompt-optimizer` Host row |
| `locale/*.json` | Metadata | Plugin Manager title and description (en, zh) |
| `icon.svg` | Metadata | Plugin icon |

Routes (loopback only; writes also require same-origin):

- `GET  /plugins/prompt-optimizer/health`
- `GET  /plugins/prompt-optimizer/models`
- `POST /plugins/prompt-optimizer/optimize` — one JSON answer (kept for scripted use)
- `POST /plugins/prompt-optimizer/optimize-stream` — `text/event-stream` frames
  (`delta` → `done`/`error`), which the dialog consumes

The client module never holds provider credentials; it only talks to those routes.

## Enable / disable

Installed in the `desktop` profile as a linked bundle. Toggle it in Settings → Plugins, or from
the Host side with `plugin_manager` `set_bundle` on `@local/prompt-optimizer`. Editing a linked
file takes effect after a profile recomposition (a Plugin Manager operation) or an app restart.

## Configuration

No Config schema: the model is chosen per use in the dialog, defaulting to the last choice, then
the deployment default from `sessionController.modelCatalog()`.

## Verification notes

- Host: `node --check`; live route probes (`health`, `models`, JSON `optimize`, streamed
  `optimize-stream`, empty-draft / unknown-model / wrong-method failures). The stream route was
  measured end to end: first delta ~25 ms, 264 `delta` frames, `done` at ~1.6 s, and the rewrite
  quoted the current project and conversation.
- Client: syntax-checked; both slot registrations verified live through the Client Inspect
  provider (`conversation.input.left` → `prompt-optimizer`; `shell.overlay` →
  `prompt-optimizer-dialog`). The shortcut registration is defensive: a missing service or a
  colliding default is logged and skipped, so the button and dialog are unaffected. Pixel-level
  rendering and the chord itself were not exercised because the running page requires its
  authenticated URL; check Settings → Shortcuts for “Open prompt optimizer” to confirm the chord.
