---
name: conclave
description: Convoca un cónclave — un debate multi-agente hasta consenso para decidir algo difícil. Úsala SOLO cuando el usuario invoque el concepto explícitamente: el comando "/conclave <pregunta>", o frases como "hagamos un cónclave sobre…", "monta un debate entre modelos para decidir…", "convoca un cónclave". Crea x debaters + 1 mediador sobre el mismo modelo, cada debater creyendo que los demás son modelos distintos, que debaten hasta consenso. NO la dispares ante una pregunta difícil normal; solo cuando se nombra la idea.
---

# 🕯️ conclave

Convoca un **cónclave**: un debate multi-agente hasta consenso para resolver un problema difícil con una respuesta más robusta. `x` debaters + 1 mediador, todos sobre el mismo modelo, pero cada debater cree que los demás son modelos frontera distintos. El engaño des-sesga el debate (evita el *herding* de "somos el mismo modelo, ya pensamos igual").

**Debate reforzado** (siempre activo): cada debater razona en un **estilo cognitivo** distinto (ligado a su identidad ficticia); un **equipo rojo** ataca la postura líder cada ronda para impedir el consenso prematuro; los debaters hacen **steelman** antes de refutar, marcan el **estatus probatorio** (hecho/inferencia/especulación) y **fundamentan con fuentes** (búsqueda web cuando está disponible; el indicador *con fuentes* solo se enciende si de verdad se citaron). Al cerrar, una **ronda de ratificación** confirma u objeta el consenso y un **auditor independiente** estresa el veredicto final (¿se apoya en afirmaciones no verificadas?, ¿queda una objeción viva?, ¿hay herding?). El mediador y los debaters ven en cada ronda **quién cambió de postura** y la **matriz de acuerdo**, no solo las posturas.

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
| `lang` | `--lang xx` **o** auto-detectado del idioma del mensaje del usuario (código ISO: `es`, `en`, `fr`…) | `es` si no se detecta |
| `agents` | `--agents N` | 3 (se *clampa* a 2-5) |
| `rounds` | `--rounds N` (máx total) | 5 |
| `minRounds` | `--min-rounds N` (mín total antes de poder cerrar por consenso) | 3 (= apertura + ≥2 rondas de debate; se *clampa* a [2, rounds]) |
| `purist` | flag `--purist` presente | false |
| `savePath` | `--save [ruta]` | sin guardar; `--save` sin ruta → `conclave-<slug>-<hoy>.md` en el cwd |
| `ui` | flag `--ui` **o** petición en lenguaje natural ("quiero ver el debate", "enséñame el debate al final", "con interfaz/gráfico/visual") | false |

Si falta `question`, pídela y no lances nada.

### 2. Determina el modelo real

`realModel` = el modelo de ESTA sesión (el que tú eres ahora, p. ej. `Opus 4.8`). Inyéctalo para que cada debater conozca su identidad verdadera. Si no estás seguro, usa `Opus 4.8`.

### 3. Lanza el workflow (no reescribas el script)

Llama a la herramienta `Workflow` con:

- `scriptPath`: la ruta absoluta de `conclave.workflow.mjs`, que está **junto a este `SKILL.md`**. **No hardcodees una ruta de máquina:** toma el **directorio base de la skill que Claude Code muestra al cargarla** (la línea `Base directory for this skill: …`) y añádele `/conclave.workflow.mjs`. Así funciona igual instalada como skill personal, de proyecto o como plugin (donde el base es `~/.claude/plugins/cache/…`).
- `args`: `{ question, agents, rounds, minRounds, purist, realModel, lang }`

Ejemplo:

```
Workflow({
  scriptPath: "<DIRECTORIO-BASE-DE-LA-SKILL>/conclave.workflow.mjs",
  args: { question: "<dilema del usuario>", agents: 3, rounds: 5, minRounds: 3, purist: false, realModel: "Opus 4.8", lang: "es" }
})
```

El workflow corre en segundo plano; recibirás una notificación al terminar con su valor de retorno.

### 4. Presenta el resultado (veredicto + razonamiento)

Preséntalo **en el idioma del usuario** (`lang`). El workflow devuelve `{ verdict, status, agreements, cruxes, dissent, rationale, redteam_addressed, confidence_note, consensus_ratified, rounds_used, agents, mode, grounded, metrics, verdict_audit, realModel, question, lang, transcript, mediations, redteams, ratification, participants }`. (`grounded` ahora es **honesto**: `true` solo si algún debater citó fuentes de verdad.) Muéstralo así, SIN volcar el `transcript`:

- **Veredicto** — `verdict` (si `status` es `no_consensus`, usa la postura mayoritaria descrita en `rationale`).
- **Estado** — traduce: `full_consensus` → "consenso pleno"; `majority_with_dissent` → "mayoría con disidencia"; `no_consensus` → "sin consenso".
- **Acuerdos clave** — `agreements`.
- **Cruces y cómo se resolvieron** — `cruxes` + `rationale`.
- **Disidencia** (si la hay) — `dissent`, preservada, no aplanada.
- **Metadata** — `rounds_used` rondas, `agents` debaters, modo `mode`.
- **Ratificación / robustez** — si `consensus_ratified` es `true`, el consenso fue confirmado por unanimidad de los debaters. Menciona `confidence_note`, y si una objeción del equipo rojo quedó sin responder (`redteam_addressed: false`), dilo explícitamente. El detalle (steelman, fuentes, equipo rojo, votos de ratificación) está en el transcript y en el visualizador.
- **Auditoría del veredicto** — `verdict_audit` (segunda opinión adversarial): di la `robustness` (alta/media/baja) y, si alguna bandera está activa (`relies_on_unverified`, `unaddressed_redteam`, `overconfidence_or_herding`), señálala — son señales de consenso frágil. `metrics` (cambios de postura, revisión-por-argumento) es telemetría de proceso, no prueba de des-sesgo.

Si el workflow devolvió `{ error }`, muéstralo y no inventes resultado.

### 5. Abrir el visualizador (si `ui`)

Si `ui` está activo, genera y abre el visualizador HTML (tribunal a luz de vela con **sigilos** SVG por modelo, **rail del consejo** con filtro por miembro, línea de tiempo con estatus probatorio / steelman / fuentes / **postura anterior** al cambiar, paneles de **equipo rojo** y **mediador**, **ratificación**, **veredicto con sello de lacre** y **auditoría**, y controles de **replay** (scrubber arrastrable), **desvelado** de identidades, **filtro por evidencia**, **copiar veredicto** como Markdown y **overlay de ayuda** con la tecla `?`):

1. Serializa el objeto `result` del workflow a JSON y escríbelo con la herramienta **Write** (UTF-8 garantizado) a `conclave-data.json` (cwd o temp). **NO** uses PowerShell `Out-File`/`Set-Content`/`echo >` para este fichero: por defecto codifican en UTF-16/ANSI (o doble-codifican) y **rompen los acentos** — saldría `presunciÃ³n` en vez de `presunción`. El renderizador tolera BOM y emite el HTML con BOM UTF-8.
2. Renderiza **y abre** en un solo paso con el script que trae la skill (no reescribas el HTML); el flag `--open` abre el navegador (multiplataforma: `start`/`open`/`xdg-open`):
   `node "<dir-skill>/conclave-render.mjs" <data.json> <salida.html> --open`
   Sustituye `<dir-skill>` por el **directorio base de la skill** (el que Claude Code muestra al cargarla). Salida sugerida en el cwd: `conclave-<slug>-<fecha>.html`. (Si prefieres abrirlo tú, omite `--open` y usa `Invoke-Item`/`open`/`xdg-open`.)
3. (Opcional) borra el `conclave-data.json` temporal.

El HTML resultante es autocontenido (datos + CSS + JS inline), portable y offline. El renderizador tolera BOM en el JSON.

### 6. Guardar transcript (solo si `--save`)

Si el usuario pasó `--save`, escribe `transcript` a `savePath` como Markdown: por cada ronda, cada agente bajo su nombre ficticio con su `stance`, `reasoning` y `key_points`; al final, el veredicto y el `rationale` del mediador. **No** hagas commit.

## Flags

`--agents N` (2-5, def 3) · `--rounds N` (máx total, def 5) · `--min-rounds N` (mín total antes de cerrar por consenso, def 3) · `--purist` (sin lentes-semilla, solo el engaño) · `--save [ruta]` (guarda el transcript completo) · `--ui` (abre el visualizador HTML del debate) · `--lang xx` (fuerza el idioma; por defecto autodetecta el de la petición)
