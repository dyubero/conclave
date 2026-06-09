# 🕯️ conclave

> A **conclave** for Claude Code: a multi-agent debate-to-consensus that decides hard dilemmas with a more robust answer than a single pass.
> *A multi-agent, same-model, identities-disguised debate-to-consensus skill for Claude Code.*

`conclave` spins up **x debaters + 1 red team + 1 mediator**, all on your session's **same model** — but each debater is made to **believe its peers are frontier models from other labs**. That deception **de-biases** the debate: it breaks the *herding* of "we're the same model, we already think alike" and treats another agent's agreement as independent corroboration. They debate to consensus (or dissent honestly), and you can optionally watch it all unfold in a candlelit-courtroom **HTML viewer**.

---

## Why a deception?

Because every agent is the same model, belief alone produces only weak divergence. So each debater also reasons in a fixed **cognitive style** (formalist / lateral / empiricist / adversarial skeptic / synthesizer). The result is a debate with genuine divergence and honest convergence.

## Features

- **Deception + cognitive styles** — real divergence between identical agents.
- **Red team** that attacks the leading position each round to stop premature consensus.
- **Steelman** required before rebutting, plus **evidentiary status** per point (fact / inference / speculation).
- **Source grounding** (when web search is available; the "grounded" indicator is honest).
- Final **ratification** by unanimity and a **verdict audit** (adversarial second opinion: does it lean on the unverified? is there a live objection? is there herding?).
- **Process telemetry** (stance changes, revision-per-argument) and **honest output** (never forces a false agreement).
- **HTML viewer**, self-contained and offline (`--ui`): council rail, timeline, red-team / mediator / audit panels, wax-sealed verdict, replay, identity reveal, evidence filter, copy verdict, and help.
- **Live view** (`--live`): a viewer that fills in **in real time** while the conclave debates.
- **Bilingual** (en/es, auto-detected) and cross-platform.

## Requirements

- **Claude Code** with the **`Workflow`** tool.
- **Node.js** installed (the skill runs `node` for the viewer).

## Installation (as a plugin)

```text
/plugin marketplace add dyubero/conclave
/plugin install conclave@conclave-marketplace
```

> The first line registers this repo as a *marketplace*; the second installs the plugin.

For a **team/project**, in `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "conclave-marketplace": { "source": { "source": "github", "repo": "dyubero/conclave" } }
  },
  "enabledPlugins": { "conclave@conclave-marketplace": true }
}
```

## Usage

```text
/conclave Monorepo or multirepo for a team of 5?
/conclave <question> --ui                 # opens the viewer when it finishes
/conclave <question> --agents 4 --rounds 5 --ui
```

It also triggers in **natural language** when you invoke the concept: *"let's hold a conclave about…"*, *"set up a debate between models to decide…"* (and the Spanish equivalents). It does **not** fire on just any hard question — only when the idea is named (it's expensive: ~`agents × rounds` agents).

### Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `--agents N` | 3 | number of debaters (2-5) |
| `--rounds N` | 5 | maximum round cap |
| `--min-rounds N` | 3 | minimum before consensus can close |
| `--purist` | off | no cognitive styles (deception only — the experiment) |
| `--save [path]` | off | saves the full transcript as Markdown |
| `--ui [path]` | off | opens the HTML viewer (defaults to a temp file) |
| `--live` | off | viewer that fills in **in real time** while debating |
| `--lang xx` | auto | forces the language (auto-detects by default) |

## How it works

Each round: `parallel(debaters) → red team → mediator`. The mediator distinguishes **genuine** consensus from a facade and never closes before `min-rounds`. When consensus is declared, a **ratification** round confirms or objects; then an independent **auditor** stress-tests the verdict. The `agent()` calls are *one-shot*; the script feeds the transcript between rounds, rendered **per-agent** so the deception stays symmetric (each one believes it's the only instance of its model).

## Repo structure

```text
.claude-plugin/   plugin.json · marketplace.json
skills/conclave/  SKILL.md · conclave.workflow.mjs · conclave-render.mjs · conclave-live.mjs · conclave.viewer.html
2026-06-04-conclave-design.md   living spec (§1-16)
2026-06-04-conclave-plan.md     implementation plan (historical, v1)
```

The **full spec** lives in [`2026-06-04-conclave-design.md`](./2026-06-04-conclave-design.md).

## License

MIT — see [LICENSE](./LICENSE).
