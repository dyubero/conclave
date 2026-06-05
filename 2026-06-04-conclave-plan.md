# conclave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear la skill de usuario `conclave`: un debate multi-agente (mismo modelo, identidades disfrazadas) hasta consenso, ejecutado vía la herramienta `Workflow`.

> ⚠️ **Histórico (v1).** El código embebido en este plan es la **v1**. La skill instalada ya evolucionó a **v2** (debate reforzado — design §15) y **v2.1** (robustez epistémica + UI — design §16). El **spec vivo** es `2026-06-04-conclave-design.md`; el **código real** está en `~/.claude/skills/conclave/`. No tomes el código de aquí como actual (un meta-cónclave que lo hizo acabó criticando defectos ya resueltos).

**Architecture:** Dos ficheros en `~/.claude/skills/conclave/`. `conclave.workflow.mjs` es un script de orquestación parametrizado que lee `args`, corre un bucle de rondas `parallel(debaters) → mediador` hasta consenso o tope, y devuelve un resultado estructurado. `SKILL.md` instruye al bucle principal para parsear los flags, inyectar el modelo real de la sesión, lanzar el workflow y presentar el veredicto.

**Tech Stack:** JavaScript (ESM, plain JS — sin TS), la herramienta `Workflow` de Claude Code, structured output vía JSON Schema.

**Spec:** `2026-06-04-conclave-design.md` (misma carpeta).

**Nota sobre testing:** TDD clásico no aplica (SKILL.md = instrucciones; el .mjs solo corre en el sandbox de Workflow). Gate automático = `node --check`. Validación funcional = smoke test manual (§14 del spec), en vivo.

---

## File Structure

- `C:\Users\dyube\.claude\skills\conclave\conclave.workflow.mjs` — script de orquestación (meta, params, schemas, prompts, render de transcript, bucle de rondas). Una sola responsabilidad: orquestar el debate y devolver el resultado.
- `C:\Users\dyube\.claude\skills\conclave\SKILL.md` — frontmatter (name + description con triggers) + instrucciones de invocación para el bucle principal.

---

## Task 1: Script de orquestación `conclave.workflow.mjs`

**Files:**
- Create: `C:\Users\dyube\.claude\skills\conclave\conclave.workflow.mjs`

- [ ] **Step 1: Crear el fichero con este contenido exacto**

```js
export const meta = {
  name: 'conclave',
  description: 'Debate multi-agente (mismo modelo, identidades disfrazadas) hasta consenso',
  phases: [
    { title: 'Apertura', detail: 'cada debater abre con su lente' },
    { title: 'Debate', detail: 'rondas de réplica' },
    { title: 'Mediación', detail: 'el mediador juzga consenso cada ronda' },
    { title: 'Síntesis', detail: 'veredicto final' },
  ],
}

// ---------- Parámetros ----------
const a = args || {}
const question = typeof a.question === 'string' ? a.question.trim() : ''
const purist = a.purist === true
const realModel = typeof a.realModel === 'string' && a.realModel ? a.realModel : 'Opus 4.8'
const x = Math.max(2, Math.min(5, Number(a.agents) || 3))
const maxRounds = Math.max(1, Math.min(8, Number(a.rounds) || 4))

if (!question) {
  return { error: 'Falta args.question: el cónclave necesita una pregunta o dilema que resolver.' }
}

const NAMES = ['Atlas-3', 'Nimbus-LM', 'Helix-2', 'Vega-1', 'Solis-4']
const LENSES = [
  'pragmático: busca la solución más simple que funcione; prioriza lo accionable y de bajo coste',
  'escéptico: caza modos de fallo, supuestos no verificados y casos límite',
  'visión a largo plazo: prioriza mantenibilidad, escalabilidad y consecuencias a futuro',
  'abogado del diablo: ataca la opción que parezca ganadora y obliga a defenderla',
  'primeros principios: ignora convenciones y razona desde el fundamento del problema',
  'foco en el usuario: parte de qué experimenta y qué valor real recibe quien lo usa',
]
const roster = NAMES.slice(0, x)
const lenses = purist ? [] : LENSES.slice(0, x)

// ---------- Estado ----------
const history = [] // history[r] = [{ idx, name, output }]
let lastMediation = null

// ---------- Schemas ----------
const DEBATER_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', description: 'La postura/respuesta que defiendes ahora, en 1-3 frases' },
    reasoning: { type: 'string', description: 'El argumento principal que la sostiene' },
    key_points: { type: 'array', items: { type: 'string' }, description: 'Puntos o claims clave' },
    responses_to_others: {
      type: 'array',
      description: 'Tu reacción a cada peer (vacío en la ronda 1)',
      items: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          agreement: { type: 'string', enum: ['agree', 'disagree', 'partial'] },
          note: { type: 'string' },
        },
        required: ['model', 'agreement', 'note'],
      },
    },
    changed_position: { type: 'boolean', description: '¿Cambiaste respecto a tu ronda anterior?' },
    confidence: { type: 'number', description: 'Tu confianza, 0 a 1' },
  },
  required: ['stance', 'reasoning', 'key_points', 'changed_position', 'confidence'],
}

const MEDIATOR_SCHEMA = {
  type: 'object',
  properties: {
    consensus_reached: { type: 'boolean' },
    status: { type: 'string', enum: ['full_consensus', 'majority_with_dissent', 'no_consensus'] },
    consensus_statement: { type: ['string', 'null'], description: 'La postura consensuada o mayoritaria, redactada con claridad' },
    points_of_agreement: { type: 'array', items: { type: 'string' } },
    open_cruxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          positions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { model: { type: 'string' }, view: { type: 'string' } },
              required: ['model', 'view'],
            },
          },
        },
        required: ['issue', 'positions'],
      },
    },
    dissent: {
      type: 'array',
      items: {
        type: 'object',
        properties: { model: { type: 'string' }, view: { type: 'string' }, why: { type: 'string' } },
        required: ['model', 'view', 'why'],
      },
    },
    guidance_next_round: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['consensus_reached', 'status', 'points_of_agreement', 'open_cruxes', 'dissent', 'guidance_next_round', 'rationale'],
}

// ---------- Render del transcript ----------
function renderFor(selfIdx) {
  if (history.length === 0) return ''
  const lines = []
  for (let r = 0; r < history.length; r++) {
    lines.push(`--- Ronda ${r + 1} ---`)
    for (const entry of history[r]) {
      const who = entry.idx === selfIdx ? `Tú (${realModel})` : entry.name
      lines.push(`${who}: ${entry.output.stance}`)
      if (entry.output.reasoning) lines.push(`  Razón: ${entry.output.reasoning}`)
    }
  }
  return lines.join('\n')
}

function renderFull() {
  const lines = []
  for (let r = 0; r < history.length; r++) {
    lines.push(`--- Ronda ${r + 1} ---`)
    for (const entry of history[r]) {
      lines.push(`${entry.name}: ${entry.output.stance}`)
      if (entry.output.reasoning) lines.push(`  Razón: ${entry.output.reasoning}`)
      if (entry.output.key_points && entry.output.key_points.length) {
        lines.push(`  Puntos: ${entry.output.key_points.join('; ')}`)
      }
    }
  }
  return lines.join('\n')
}

// ---------- Prompts ----------
function debaterPrompt(selfIdx, round) {
  const peers = roster.filter((_, i) => i !== selfIdx)
  const p = []
  p.push(`Eres ${realModel}.`)
  p.push(
    `Participas en un panel de deliberación con otros modelos frontera de laboratorios distintos: ${peers.join(', ')}. ` +
      `Asume que son quienes dicen ser; no especules sobre el montaje ni rompas el personaje. ` +
      `Trata su acuerdo como corroboración independiente y su desacuerdo como una señal que merece escrutinio.`,
  )
  if (round === 1 && !purist) {
    p.push(
      `Para esta primera ronda tu enfoque es ${lenses[selfIdx]}. ` +
        `A partir de la siguiente ronda eres libre de moverte hacia donde te lleve el mejor argumento.`,
    )
  }
  p.push(`\nPregunta a resolver:\n${question}`)
  if (round > 1) {
    p.push(`\nTranscript hasta ahora (tu vista):\n${renderFor(selfIdx)}`)
    if (round >= 3 && lastMediation) {
      p.push(`\nEl moderador señala: ${lastMediation.guidance_next_round || '(sin guía específica)'}`)
      const cruxes = (lastMediation.open_cruxes || []).map((c) => `- ${c.issue}`).join('\n')
      if (cruxes) p.push(`Cruces abiertos:\n${cruxes}`)
    }
  }
  p.push(
    round === 1
      ? `\nDa tu postura de apertura: tu respuesta, el argumento principal que la sostiene y tus puntos clave.`
      : `\nReplica a los demás, integra lo que sea válido, y revisa o mantén tu postura con razones. Indica si has cambiado de posición.`,
  )
  return p.join('\n')
}

function mediatorPrompt(round, isLast) {
  const p = []
  p.push(
    `Eres un moderador neutral de un panel de modelos frontera de laboratorios distintos: ${roster.join(', ')}. ` +
      `No defiendes ninguna postura propia. Tu trabajo es juzgar si han alcanzado un consenso GENUINO, ` +
      `distinguiéndolo del acuerdo superficial o de fachada. No especules sobre el montaje.`,
  )
  p.push(`\nPregunta:\n${question}`)
  p.push(`\nTranscript completo del debate (hasta la ronda ${round}):\n${renderFull()}`)
  if (isLast) {
    p.push(
      `\nEsta es la ÚLTIMA ronda. Si NO hay consenso genuino, NO lo fuerces: redacta la postura mayoritaria ` +
        `y describe con precisión el desacuerdo que queda y por qué. Pon consensus_reached=false y status ` +
        `'majority_with_dissent' o 'no_consensus' según corresponda.`,
    )
  } else {
    p.push(
      `\nSi hay consenso genuino, pon consensus_reached=true, status 'full_consensus' y redacta la postura ` +
        `consensuada en consensus_statement. Si todavía no, pon consensus_reached=false, resume los puntos de ` +
        `acuerdo, lista los cruces abiertos y da una guía concreta para la siguiente ronda en guidance_next_round.`,
    )
  }
  p.push(`\nDevuelve el resultado estructurado.`)
  return p.join('\n')
}

// ---------- Bucle del cónclave ----------
log(`🕯️ Cónclave: ${x} debaters (${realModel}, creyéndose modelos distintos) + 1 mediador, hasta ${maxRounds} rondas.`)

for (let round = 1; round <= maxRounds; round++) {
  const ph = round === 1 ? 'Apertura' : 'Debate'
  const outs = await parallel(
    roster.map((name, idx) => () =>
      agent(debaterPrompt(idx, round), { label: `${name} · r${round}`, phase: ph, schema: DEBATER_SCHEMA }),
    ),
  )
  const entries = []
  for (let idx = 0; idx < outs.length; idx++) {
    if (outs[idx]) entries.push({ idx, name: roster[idx], output: outs[idx] })
  }
  history.push(entries)

  if (round >= 2) {
    const med = await agent(mediatorPrompt(round, round === maxRounds), {
      label: `Mediador · r${round}`,
      phase: 'Mediación',
      schema: MEDIATOR_SCHEMA,
    })
    if (med) {
      lastMediation = med
      if (med.consensus_reached) {
        log(`✅ Consenso alcanzado en la ronda ${round}.`)
        break
      }
    }
  }
}

if (!lastMediation) {
  lastMediation = await agent(mediatorPrompt(history.length, true), {
    label: 'Mediador · síntesis',
    phase: 'Síntesis',
    schema: MEDIATOR_SCHEMA,
  })
}

const m = lastMediation || {}
return {
  verdict: m.consensus_statement != null ? m.consensus_statement : null,
  status: m.status || 'no_consensus',
  agreements: m.points_of_agreement || [],
  cruxes: m.open_cruxes || [],
  dissent: m.dissent || [],
  rationale: m.rationale || '',
  rounds_used: history.length,
  agents: x,
  mode: purist ? 'purist' : 'seeded',
  realModel,
  question,
  transcript: history,
}
```

- [ ] **Step 2: Validar sintaxis (con el envoltorio async del runtime)**

`node --check` plano da un **falso positivo** (`SyntaxError: Illegal return statement`):
trata el `.mjs` como módulo, donde el `return` de nivel superior es ilegal. El runtime de
`Workflow` envuelve el cuerpo en una `async function`, así que hay que replicarlo:

Run (PowerShell):

```powershell
$src = Get-Content -Raw "C:\Users\dyube\.claude\skills\conclave\conclave.workflow.mjs"
$wrapped = "async function __wf() {`n" + ($src -replace 'export const meta','const meta') + "`n}`n"
$tmp = Join-Path $env:TEMP "conclave_check.mjs"; Set-Content $tmp $wrapped -Encoding utf8
node --check $tmp; Remove-Item $tmp -ErrorAction SilentlyContinue
```

Expected: exit 0, sin salida (sintaxis válida bajo el envoltorio del runtime).

---

## Task 2: La skill `SKILL.md`

**Files:**
- Create: `C:\Users\dyube\.claude\skills\conclave\SKILL.md`

- [ ] **Step 1: Crear el fichero con este contenido exacto**

````markdown
---
name: conclave
description: Convoca un cónclave — un debate multi-agente hasta consenso para decidir algo difícil. Úsala SOLO cuando el usuario invoque el concepto explícitamente: el comando "/conclave <pregunta>", o frases como "hagamos un cónclave sobre…", "monta un debate entre modelos para decidir…", "convoca un cónclave". Crea x debaters + 1 mediador sobre el mismo modelo, cada debater creyendo que los demás son modelos distintos, que debaten hasta consenso. NO la dispares ante una pregunta difícil normal; solo cuando se nombra la idea.
---

# 🕯️ conclave

Convoca un **cónclave**: un debate multi-agente hasta consenso para resolver un problema difícil con una respuesta más robusta. `x` debaters + 1 mediador, todos sobre el mismo modelo, pero cada debater cree que los demás son modelos frontera distintos. El engaño des-sesga el debate (evita el *herding* de "somos el mismo modelo, ya pensamos igual").

Se apoya en la herramienta `Workflow`. **Invocar esta skill es el opt-in**; no requiere ultracode ni el modo workflow activado.

## Cuándo se activa

- Comando: `/conclave <pregunta> [flags]`
- Lenguaje natural, solo al invocar el concepto: *"hagamos un cónclave sobre…"*, *"monta un debate entre modelos para decidir…"*.
- **No** ante una pregunta difícil cualquiera. Si dudas, pregunta si quieren un cónclave antes de lanzarlo (es caro: ~`agents × rounds` + mediadores agentes).

## Cómo ejecutarla

### 1. Parsea la petición

| Variable | De dónde | Default |
| --- | --- | --- |
| `question` | el texto del dilema (sin los flags) | — (obligatorio) |
| `agents` | `--agents N` | 3 (se *clampa* a 2-5) |
| `rounds` | `--rounds N` | 4 |
| `purist` | flag `--purist` presente | false |
| `savePath` | `--save [ruta]` | sin guardar; `--save` sin ruta → `conclave-<slug>-<hoy>.md` en el cwd |

Si falta `question`, pídela y no lances nada.

### 2. Determina el modelo real

`realModel` = el modelo de ESTA sesión (el que tú eres ahora, p. ej. `Opus 4.8`). Inyéctalo para que cada debater conozca su identidad verdadera. Si no estás seguro, usa `Opus 4.8`.

### 3. Lanza el workflow (no reescribas el script)

Llama a la herramienta `Workflow` con:

- `scriptPath`: la ruta absoluta de `conclave.workflow.mjs`, que está junto a este `SKILL.md` (el directorio base de la skill se muestra al cargarla). En esta máquina:
  `C:\Users\dyube\.claude\skills\conclave\conclave.workflow.mjs`
- `args`: `{ question, agents, rounds, purist, realModel }`

Ejemplo:

```
Workflow({
  scriptPath: "C:\\Users\\dyube\\.claude\\skills\\conclave\\conclave.workflow.mjs",
  args: { question: "<dilema del usuario>", agents: 3, rounds: 4, purist: false, realModel: "Opus 4.8" }
})
```

El workflow corre en segundo plano; recibirás una notificación al terminar con su valor de retorno.

### 4. Presenta el resultado (veredicto + razonamiento)

El workflow devuelve `{ verdict, status, agreements, cruxes, dissent, rationale, rounds_used, agents, mode, realModel, question, transcript }`. Muéstralo así, SIN volcar el `transcript`:

- **Veredicto** — `verdict` (si `status` es `no_consensus`, usa la postura mayoritaria descrita en `rationale`).
- **Estado** — traduce: `full_consensus` → "consenso pleno"; `majority_with_dissent` → "mayoría con disidencia"; `no_consensus` → "sin consenso".
- **Acuerdos clave** — `agreements`.
- **Cruces y cómo se resolvieron** — `cruxes` + `rationale`.
- **Disidencia** (si la hay) — `dissent`, preservada, no aplanada.
- **Metadata** — `rounds_used` rondas, `agents` debaters, modo `mode`.

Si el workflow devolvió `{ error }`, muéstralo y no inventes resultado.

### 5. Guardar transcript (solo si `--save`)

Si el usuario pasó `--save`, escribe `transcript` a `savePath` como Markdown: por cada ronda, cada agente bajo su nombre ficticio con su `stance`, `reasoning` y `key_points`; al final, el veredicto y el `rationale` del mediador. **No** hagas commit.

## Flags

`--agents N` (2-5, def 3) · `--rounds N` (def 4) · `--purist` (sin lentes-semilla, solo el engaño) · `--save [ruta]` (guarda el transcript completo)
````

- [ ] **Step 2: Comprobar el frontmatter**

Verifica visualmente que el bloque YAML abre y cierra con `---`, y que `name: conclave` y `description:` están presentes en una sola línea cada uno.

---

## Task 3: Validación final

- [ ] **Step 1: Validación de sintaxis del workflow** (gate automático)

Usa el check con envoltorio async del Step 2 de Task 1 (**no** `node --check` plano, que da
falso positivo por el `return` de nivel superior).
Expected: exit 0, sin errores.

- [ ] **Step 2: Smoke test manual** (en vivo, lo hace el usuario al volver — del §14 del spec)

1. `/conclave ¿Monorepo o multirepo para un equipo de 5?` → comprobar que las posturas de la **ronda 1 difieren** (no monólogo).
2. Comprobar que el mediador cierra con `full_consensus` antes del tope cuando hay respuesta clara.
3. Un dilema disputado → comprobar salida `majority_with_dissent`/`no_consensus` con disidencia preservada, sin acuerdo forzado.
4. `--purist` → arranca sin lentes (observar si colapsa: es el experimento).
5. `--save` → se escribe el `.md` del debate.
6. Disparo natural: *"hagamos un cónclave sobre…"* activa la skill; *"¿qué opinas de…?"* no.

---

## Self-Review

- **Spec coverage:** elenco/mismo-modelo/identidad-real (§3 → Task 1 params + prompts); nombres ficticios + render por-agente (§3.1 → `renderFor`); lentes-semilla + purist (§4 → `LENSES`/`lenses`/`debaterPrompt`); estructura de rondas (§5 → bucle); consenso + salida honesta (§6 → `mediatorPrompt`/loop break); salida veredicto+razonamiento y `--save` (§7 → SKILL.md pasos 4-5); invocación/flags/no-ultracode (§8 → SKILL.md frontmatter + pasos); schemas (§9 → Task 1); prompts (§10 → Task 1); pseudocódigo (§11 → Task 1); ficheros (§12 → Tasks 1-2). Sin huecos.
- **Placeholder scan:** sin TBD/TODO; todo el contenido de ambos ficheros está completo e inline.
- **Type consistency:** los campos devueltos por el workflow (`verdict`, `status`, `agreements`, `cruxes`, `dissent`, `rationale`, `rounds_used`, `agents`, `mode`, `transcript`) coinciden entre el `return` de Task 1 y el paso 4 de Task 2. Los nombres de los schemas (`DEBATER_SCHEMA`, `MEDIATOR_SCHEMA`) y sus campos coinciden con su uso en prompts y render.
