---
name: conclave
description: Convene a conclave — a multi-agent debate-to-consensus to decide something hard. Use ONLY when the user invokes the concept explicitly: the "/conclave <question>" command, or phrases like "let's hold a conclave about…", "set up a debate between models to decide…", "convene a conclave" (and their Spanish equivalents: "hagamos un cónclave sobre…", "monta un debate entre modelos para decidir…", "convoca un cónclave"). Creates x debaters + 1 mediator on the same model, each debater believing the others are different models, debating to consensus. Do NOT fire on an ordinary hard question; only when the idea is named.
---

# 🕯️ conclave

Convene a **conclave**: a multi-agent debate-to-consensus that resolves a hard problem with a more robust answer. `x` debaters + 1 mediator, all on the same model, but each debater believes the others are distinct frontier models. The deception de-biases the debate (it avoids the *herding* of "we're the same model, we already think alike").

**Reinforced debate** (always on): each debater reasons in a distinct **cognitive style** (tied to its fictional identity); a **red team** attacks the leading position every round to prevent premature consensus; debaters **steelman** before rebutting, mark the **evidentiary status** (fact/inference/speculation) and **ground claims with sources** (web search when available; the *grounded* indicator only lights up if sources were actually cited). On close, a **ratification round** confirms or objects to the consensus and an **independent auditor** stress-tests the final verdict (does it lean on unverified claims? is there a live objection? is there herding?). Every round, the mediator and debaters see **who changed position** and the **agreement matrix**, not just the positions.

It runs on the `Workflow` tool. **Invoking this skill is the opt-in**; it needs neither ultracode nor workflow mode enabled.

## When it triggers

- Command: `/conclave <question> [flags]`
- Natural language, only when the concept is invoked: *"let's hold a conclave about…"*, *"set up a debate between models to decide…"* (and the Spanish equivalents: *"hagamos un cónclave sobre…"*, *"monta un debate entre modelos para decidir…"*).
- **Not** on just any hard question. If unsure, ask whether they want a conclave before launching (it's expensive: ~`agents × rounds` + mediator agents).

## How to run it

### 1. Parse the request

| Variable | Source | Default |
| --- | --- | --- |
| `question` | the dilemma text (without the flags) | — (required) |
| `lang` | `--lang xx` **or** auto-detected from the language of the user's message (ISO code: `es`, `en`, `fr`…) | `es` if not detected |
| `agents` | `--agents N` | 3 (*clamped* to 2-5) |
| `rounds` | `--rounds N` (max total) | 5 |
| `minRounds` | `--min-rounds N` (min total before consensus can close) | 3 (= opening + ≥2 debate rounds; *clamped* to [2, rounds]) |
| `purist` | `--purist` flag present | false |
| `savePath` | `--save [path]` | no save; `--save` with no path → `conclave-<slug>-<today>.md` in the cwd |
| `ui` | `--ui` flag **or** natural-language request ("I want to see the debate", "show me the debate at the end", "with a UI/chart/visual") | false |
| `uiOut` | path or folder after `--ui` **or** a request ("save it in…", "put it on the desktop") | empty → **temp file** |
| `live` | `--live` flag **or** request ("in real time", "watch it live as it debates") | false |

If `question` is missing, ask for it and launch nothing.

### 2. Determine the real model

`realModel` = the model of THIS session (the one you are right now, e.g. `Opus 4.8`). Inject it so each debater knows its true identity. If unsure, use `Opus 4.8`.

### 3. Launch the workflow (do not rewrite the script)

Call the `Workflow` tool with:

- `scriptPath`: the absolute path of `conclave.workflow.mjs`, which sits **next to this `SKILL.md`**. **Do not hardcode a machine path:** take the **skill base directory that Claude Code shows when it loads the skill** (the `Base directory for this skill: …` line) and append `/conclave.workflow.mjs`. That way it works the same installed as a personal skill, a project skill, or a plugin (where the base is `~/.claude/plugins/cache/…`).
- `args`: `{ question, agents, rounds, minRounds, purist, realModel, lang }`

Example:

```
Workflow({
  scriptPath: "<SKILL-BASE-DIRECTORY>/conclave.workflow.mjs",
  args: { question: "<user's dilemma>", agents: 3, rounds: 5, minRounds: 3, purist: false, realModel: "Opus 4.8", lang: "es" }
})
```

The workflow runs in the background; you'll get a notification when it finishes with its return value.

### 4. Present the result (verdict + reasoning)

Present it **in the user's language** (`lang`). The workflow returns `{ verdict, verdict_detail, status, agreements, cruxes, dissent, rationale, redteam_addressed, confidence_note, consensus_ratified, rounds_used, agents, mode, grounded, metrics, verdict_audit, realModel, question, lang, transcript, mediations, redteams, ratification, participants }`. (`grounded` is **honest** —`true` only if there were real sources—; `verdict_detail` is the **in-depth answer** the mediator writes when consensus closes; `status` already reflects the **audit veto** —it won't be `full_consensus` if the auditor flagged low robustness or a live objection.) Show it like this, WITHOUT dumping the `transcript`:

- **Verdict** — if there's a `verdict_detail`, **that is the in-depth answer** you give the user (`verdict` is just the brief thesis); otherwise use `verdict` (and if `status` is `no_consensus`, the majority position described in `rationale`).
- **Status** — translate: `full_consensus` → "full consensus"; `majority_with_dissent` → "majority with dissent"; `no_consensus` → "no consensus".
- **Key agreements** — `agreements`.
- **Cruxes and how they were resolved** — `cruxes` + `rationale`.
- **Dissent** (if any) — `dissent`, preserved, not flattened.
- **Metadata** — `rounds_used` rounds, `agents` debaters, mode `mode`.
- **Ratification / robustness** — if `consensus_ratified` is `true`, the consensus was confirmed by unanimity of the debaters. Mention `confidence_note`, and if a red-team objection went unanswered (`redteam_addressed: false`), say so explicitly. The detail (steelman, sources, red team, ratification votes) is in the transcript and the viewer.
- **Verdict audit** — `verdict_audit` (adversarial second opinion): state the `robustness` (high/medium/low) and, if any flag is on (`relies_on_unverified`, `unaddressed_redteam`, `overconfidence_or_herding`), point it out — they're signs of fragile consensus. `metrics` (stance changes, revision-per-argument) is process telemetry, not proof of de-biasing.

If the workflow returned `{ error }`, show it and don't invent a result.

### 5. Open the viewer (if `ui`)

If `ui` is on, generate and open the HTML viewer (candlelit courtroom with SVG **sigils** per model, a **council rail** with per-member filter, a timeline with evidentiary status / steelman / sources / **previous stance** on change, **red team** and **mediator** panels, **ratification**, **wax-sealed verdict** and **audit**, plus **replay** controls (draggable scrubber), identity **reveal**, **evidence filter**, **copy verdict** as Markdown and a **help overlay** on the `?` key):

1. Serialize the workflow's `result` object to JSON and write it with the **Write** tool (UTF-8 guaranteed) to a **temp** file, e.g. `<temp>/conclave-data.json` (Windows `%TEMP%`, macOS/Linux `/tmp`). Do **NOT** use PowerShell `Out-File`/`Set-Content`/`echo >` for this file: by default they encode as UTF-16/ANSI (or double-encode) and **break accents** — you'd get `presunciÃ³n` instead of `presunción`. The renderer tolerates a BOM and emits the HTML with a UTF-8 BOM.
2. Render **and open** in one step with the skill's script (do not rewrite the HTML). **By default OMIT the output path**: that way the HTML is written to a **temp OS file** and doesn't clutter the project. The `--open` flag opens the browser (cross-platform `start`/`open`/`xdg-open`); the script **prints the final path** of the HTML (relay it to the user):
   `node "<skill-dir>/conclave-render.mjs" <data.json> --open`
   - **Only if the user asks to save it** somewhere specific (`--ui <path>`, "save it in…", a folder or file): pass it as the 2nd argument → `node "<skill-dir>/conclave-render.mjs" <data.json> <output.html> --open` (name suggestion: `conclave-<slug>-<date>.html`).
   Replace `<skill-dir>` with the **skill base directory** (the one Claude Code shows when it loads the skill).
3. Delete the temp `conclave-data.json` (the HTML is self-contained).

The resulting HTML is self-contained (data + CSS + JS inline), portable and offline. The renderer tolerates a BOM in the JSON.

### 5b. Live view (if `live`)

`--live` opens a viewer that **fills in while the conclave debates** (not post-hoc). The workflow sandbox can't serve anything, so a **companion** does it: `conclave-live.mjs` tails the `journal.jsonl` that the runtime writes (one structured result per agent as it finishes), reconstructs the debate and serves it over **SSE**. Steps, **before** launching the Workflow:

1. Write a **meta sidecar** with the **Write** tool (UTF-8) to `<temp>/conclave-live-meta.json`: `{ question, lang, realModel, agents, mode, participants: [{idx, fictionalName, trueModel, style}] }`. The journal does NOT contain the question or the roster (Atlas-3, Ali-10, Helix-2, Vega-1, Solis-4 + their styles); they come from here.
2. Start the server **in the background** (if not already running): `node "<skill-dir>/conclave-live.mjs" --open` (opens the browser; auto-detects the most recent journal and reads the meta).
3. Launch the conclave Workflow normally. The server switches to the new journal on its own and the browser fills **round by round**.

When it finishes, the same server shows the full debate (it doubles as a post-hoc view). To stop it, kill the `node` process (e.g. by port 4317). **Caveat:** it depends on the internal `journal.jsonl` format (not a public Claude Code API; an update could break it).

### 6. Save transcript (only if `--save`)

If the user passed `--save`, write `transcript` to `savePath` as Markdown: for each round, each agent under its fictional name with its `stance`, `reasoning` and `key_points`; at the end, the mediator's verdict and `rationale`. Do **not** commit.

## Flags

`--agents N` (2-5, def 3) · `--rounds N` (max total, def 5) · `--min-rounds N` (min total before closing by consensus, def 3) · `--purist` (no seed-lenses, deception only) · `--save [path]` (saves the full transcript) · `--ui [path]` (opens the HTML viewer; defaults to a **temp file** — pass a path/folder to save it there) · `--live` (viewer that fills in **in real time** while debating, via `conclave-live.mjs` + SSE) · `--lang xx` (forces the language; auto-detects the request's language by default)
