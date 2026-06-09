# 🕯️ `conclave` — Design Spec

**Fecha:** 2026-06-04
**Estado:** diseño aprobado, pendiente de plan de implementación
**Tipo:** skill de usuario para Claude Code (general, no específica de ningún repo)

---

## 1. Resumen

`conclave` es una skill que convoca un **debate multi-agente hasta consenso** para
resolver un problema difícil con una respuesta más robusta que la de un solo paso.

Crea `x` agentes **debaters** + 1 **mediador** (`x+1` en total). **Todos corren sobre
el mismo modelo** (el de la sesión). Cada debater conoce su identidad **real**, pero
**cree que el resto de participantes son modelos frontera distintos** (de otros
laboratorios). El mediador dirige el debate, juzga cuándo hay consenso genuino y
redacta el veredicto.

El entregable es el **veredicto de consenso + su razonamiento**.

---

## 2. Concepto y fundamento

### 2.1 Por qué el engaño (la idea central)

Esto es *multi-agent debate* (técnica conocida para mejorar razonamiento) con una capa
de **engaño deliberado**: cada agente cree que debate con arquitecturas distintas. El
engaño no es decorativo — es una **palanca de des-sesgo**:

- Si un agente creyera que los demás son copias de sí mismo, caería en (a) *herding* /
  falso consenso instantáneo ("somos el mismo modelo, ya pensamos igual, firmo") y (b)
  infravalorar la coincidencia ajena.
- Al creer que debate con modelos distintos, trata el **acuerdo** de un peer como
  **corroboración independiente** y el **desacuerdo** como **señal informativa** que
  merece escrutinio.

### 2.2 El problema de los pesos idénticos (y su solución)

Como todos son literalmente el mismo modelo, la creencia por sí sola genera divergencia
**débil** — y en el motor de workflow no se puede subir la temperatura por separado, la
única variación entre llamadas viene del *prompt*. Riesgo concreto: en la ronda 1 los
`x` agentes producen casi la misma respuesta → "consenso" que en realidad es un
monólogo, y la skill no aporta nada.

**Solución:** sembrar diversidad con **lentes de análisis distintas** en la apertura
(ver §4). Modo `--purist` para desactivarlas y probar la hipótesis "el engaño solo,
¿basta?".

---

## 3. El elenco de agentes

| Rol | Cantidad | Modelo real | Cree que es… | Cree que los demás son… |
| --- | --- | --- | --- | --- |
| Debater | `x` (default 3, rango 2-5) | el de la sesión | su modelo real | modelos frontera distintos (nombres ficticios) |
| Mediador | 1 | el de la sesión | moderador neutral | modelos frontera distintos |

- **Mismo modelo para todos.** Los `agent()` no llevan override de modelo → heredan el
  modelo del bucle principal (la sesión). Es lo que garantiza "mismo modelo".
- **Identidad real inyectada al lanzar.** El bucle principal sustituye el nombre real
  del modelo de la sesión (`realModel`, p. ej. `Opus 4.8`) en los prompts, para cumplir
  literalmente "todos saben qué modelo son ellos mismos" sea cual sea el modelo activo.
  Default `Opus 4.8` si no se puede determinar.
- **Nombres ficticios plausibles** (no marcas reales, para evitar estereotipos
  contaminantes como deferir ante un rival percibido como más fuerte):
  `Atlas-3`, `Ali-10`, `Helix-2`, `Vega-1`, `Solis-4`. Se asignan los primeros `x`.
- **El mediador también está engañado** (no se le cuenta que todos son el mismo modelo),
  para que valore el acuerdo entre ellos como corroboración independiente.
- **Instrucción anti-meta** para todos: asumir que los demás son quienes dicen ser, no
  especular sobre el montaje, no romper personaje.

### 3.1 Renderizado del transcript por-agente (fidelidad del engaño)

Cada debater tiene un nombre ficticio **tal y como lo ven los demás**, pero **nunca ve
su propio nombre ficticio**: al construir su prompt, sus intervenciones previas se
etiquetan como **"Tú (`realModel`)"** y las de los demás bajo **sus nombres ficticios**.
Resultado: cada debater cree ser el único de su modelo entre rivales. El mediador ve a
todos bajo nombres ficticios. La vista es por-agente; nunca comparan notas fuera del
transcript, así que el engaño es simétrico y consistente.

---

## 4. Motor de divergencia: lentes-semilla

**Pool de lentes** (arquetipos de análisis; se asignan las primeras `x`):

1. **Pragmático / simplicidad** — la solución más simple que funcione; sesga hacia lo
   accionable y de bajo coste.
2. **Escéptico / riesgos** — caza modos de fallo, supuestos no verificados, casos límite.
3. **Visión largo plazo** — mantenibilidad, escalabilidad, consecuencias a futuro.
4. **Abogado del diablo** — ataca la opción que parece ganadora; fuerza a defenderla.
5. **Primeros principios** — ignora convenciones; razona desde el fundamento del problema.
6. **Foco usuario / stakeholder** — qué experimenta quien lo usa; valor real entregado.

(Default `x=3` → tríada *pragmático / escéptico / largo-plazo*.)

**Regla:** la lente es **semilla, no jaula**. Se aplica solo en la **ronda 1**. Desde la
ronda 2 cada agente es **libre** de moverse hacia el mejor argumento. Esto da diversidad
inicial **y** convergencia honesta. Con `--purist` no se asignan lentes.

---

## 5. Estructura de rondas y orquestación

Construida sobre la herramienta **`Workflow`**. Los `agent()` son *one-shot* sin memoria;
**el script carga el transcript** entre rondas. La forma es un bucle secuencial de
`[parallel(debaters) → mediador]`:

1. **Ronda 1 — Apertura** (`parallel`): cada debater recibe identidad + peers ficticios +
   su lente + la pregunta, y da su postura de apertura.
2. **Rondas 2…N — Debate** (`parallel`): cada debater recibe el transcript acumulado
   **renderizado a su vista** (§3.1) y, desde la ronda 3, también el resumen/guía del
   mediador; replica, integra lo válido de otros y revisa o mantiene su postura.
3. **Mediación** (tras cada ronda ≥ 2): el mediador resume, marca acuerdos y *cruces*
   pendientes, y **decide si hay consenso**. Su `guidance_next_round` y los cruces
   abiertos se inyectan a los debaters de la ronda siguiente (mediador activo, no mero
   observador).
4. **Rondas: mín 3, máx 5** (configurable vía `--min-rounds` / `--rounds`). El consenso
   **no puede cerrar el debate antes de `minRounds`** (default 3 = apertura + ≥2 rondas de
   debate). En las rondas tempranas el mediador es **escéptico**: aunque las posturas
   coincidan, no declara consenso y fuerza otra ronda con la objeción más fuerte. **Cierre
   anticipado** solo a partir de `minRounds`, si el mediador declara consenso genuino.

> **Barrera justificada:** dentro de cada ronda los debaters van en `parallel()` y hay
> una barrera antes del mediador — necesita **todas** las posturas de la ronda para
> juzgar. Por eso es un bucle de barreras, no un `pipeline()`.

### 5.1 Coste aproximado

Para `x=3`, `rounds=4`: ~12 llamadas de debater + ~3 de mediador ≈ **15 agentes**.
Escala con `x × rounds`. Es caro por diseño; de ahí el disparo solo-explícito (§8).

---

## 6. Protocolo de consenso

- **Lo decide el mediador** (criterio principal), con la **estabilidad entre rondas**
  (¿dejan de cambiar las posturas?) como señal de apoyo que el mediador considera.
- El mediador distingue **acuerdo genuino** de **acuerdo de fachada** (el *sycophancy*
  que el engaño busca evitar).
- **Cierre anticipado** en cuanto hay consenso real, **pero nunca antes de `minRounds`**
  (default 3 → ≥2 rondas de debate). En rondas tempranas el mediador no puede declarar
  consenso: identifica el punto más débil del (aparente) acuerdo y lanza la objeción más
  fuerte para la siguiente ronda. Esto evita que el mismo modelo "se firme a sí mismo" en
  la ronda 2.
- **Sin consenso al agotar el tope:** el mediador **no fuerza** un acuerdo falso. Emite
  síntesis honesta = **postura mayoritaria + el desacuerdo concreto que queda y por qué**.
  Se preserva la información en lugar de aplanarla.

Estados posibles: `full_consensus` · `majority_with_dissent` · `no_consensus`.

---

## 7. Salida / entregable

**En el chat — veredicto + razonamiento:**

- La **respuesta de consenso** (o mayoritaria), redactada con claridad.
- **Estado** (`full_consensus` / `majority_with_dissent` / `no_consensus`).
- Los **cruces clave** debatidos y **cómo se resolvieron**.
- **Disidencia** que quede, preservada (no aplanada).
- **Metadata:** rondas usadas, `x`, modo (`seeded`/`purist`).

**Transcript completo:** solo con `--save [ruta]` (por defecto **no** se guarda). Se
escribe un `.md` con el debate ronda a ronda de cada agente (con sus nombres ficticios).
Si se pasa `--save` sin ruta, default `conclave-<slug-tema>-<fecha-de-hoy>.md` en el
`cwd`. El bucle principal escribe el fichero tras devolver el workflow y estampa la fecha
(los scripts de workflow no tienen acceso a `Date`); la skill es portable, no se hardcodea
ninguna ruta de proyecto. Sin commit automático.

**Visualizador HTML (`--ui` o petición en lenguaje natural "quiero ver el debate"):**
genera un `.html` autocontenido y bonito (tema oscuro a luz de vela) y lo abre en el
navegador. Muestra: **tarjetas de identidad** que revelan el engaño (nombre ficticio +
identidad real + lente), el **debate ronda a ronda** estilo chat con color por
participante, las **intervenciones del mediador**, el **panel de veredicto**, y un botón
▶ **replay** que reproduce el debate mensaje a mensaje (sensación de directo). Lo produce
el bucle principal tras el workflow: serializa `result` a JSON → `node conclave-render.mjs
<data.json> <out.html>` (inyecta los datos en `conclave.viewer.html`) → abre el fichero.
Es **post-debate**: el sandbox del workflow no puede servir una GUI en vivo, pero el
`log()` narra el debate en texto en tiempo real en `/workflows`.

**Diseño del visualizador (v2):** tribunal arcano a luz de vela — tipografía serif clásica,
grano y resplandor. **Sigilos SVG** únicos por modelo (deterministas), **rail del consejo**
(clic en un miembro filtra sus intervenciones), línea de tiempo con **estatus probatorio**
coloreado, steelman, autocrítica y fuentes, paneles de **equipo rojo** y **mediador**,
**ratificación** y **veredicto con sello de lacre**. Interacción: **scrubber** de replay
arrastrable, **desvelado** dramático de identidades, **filtro por estatus probatorio**,
medidor de **divergencia** y atajos de teclado. Todo vanilla (sin dependencias), offline.

---

## 8. Invocación y empaquetado

- **Nombre:** `conclave`.
- **Comando:** `/conclave <pregunta> [flags]`.
- **Lenguaje natural:** se activa también al **invocar el concepto explícitamente**
  (*"hagamos un cónclave sobre X"*, *"monta un debate entre modelos para decidir Y"*),
  vía el campo `description`. **No** salta sola ante una pregunta difícil cualquiera —
  solo cuando se nombra la idea.
- **Aviso de coste:** al arrancar, `log()` anuncia qué se lanza
  (*"🕯️ Cónclave: 3 debaters + mediador, hasta 4 rondas sobre: …"*). No pide
  confirmación extra (ya se invocó por nombre).
- **Ámbito:** skill a **nivel usuario** (`~/.claude/skills/conclave/`), disponible en
  cualquier repo.
- **No requiere ultracode.** Está construida sobre el motor de workflows, y la propia
  invocación de la skill **es** el opt-in de la herramienta `Workflow` ("el usuario
  invocó una skill cuyas instrucciones le dicen que llame a Workflow"). Funciona en
  sesión normal. Único requisito: que la versión de Claude Code tenga `Workflow`.
- **Empaquetado:** la skill **trae el script de orquestación ya escrito** como fichero;
  el bucle principal parsea los flags, arma el objeto `args` y llama a
  `Workflow({ scriptPath, args })`. Nada de re-improvisar la orquestación.

### 8.1 Flags

| Flag | Default | Efecto |
| --- | --- | --- |
| `--agents N` | `3` | nº de debaters (2-5) |
| `--rounds N` | `5` | tope (máx) de rondas |
| `--min-rounds N` | `3` | mín de rondas antes de poder cerrar por consenso (clamp [2, rounds]) |
| `--purist` | off | sin lentes-semilla (solo el engaño) |
| `--save [ruta]` | off | guarda el transcript completo |
| `--ui` | off | abre un visualizador HTML del debate (post-debate, con replay animado) |

(Opcional futuro, fuera de alcance v1: `--names real` para el modo experimento con
nombres reales de la competencia.)

---

## 9. Esquemas de structured output

Cada agente devuelve datos validados (vía `schema` en `agent()`) para que el script
razone la convergencia de forma determinista.

**`DEBATER_SCHEMA`:**

```json
{
  "stance": "string — postura/respuesta que defiende ahora, 1-3 frases",
  "reasoning": "string — argumento principal que la sostiene",
  "key_points": ["string — puntos/claims clave"],
  "responses_to_others": [
    {
      "model": "string — nombre ficticio del peer",
      "agreement": "agree | disagree | partial",
      "note": "string — qué acepta o refuta y por qué"
    }
  ],
  "changed_position": "boolean — ¿cambió respecto a su ronda anterior?",
  "confidence": "number 0-1"
}
```

(En la ronda 1, `responses_to_others` va vacío y `changed_position` es `false`.)

**`MEDIATOR_SCHEMA`:**

```json
{
  "consensus_reached": "boolean",
  "status": "full_consensus | majority_with_dissent | no_consensus",
  "consensus_statement": "string|null — postura consensuada/mayoritaria, clara",
  "points_of_agreement": ["string"],
  "open_cruxes": [
    { "issue": "string", "positions": [{ "model": "string", "view": "string" }] }
  ],
  "dissent": [{ "model": "string", "view": "string", "why": "string" }],
  "guidance_next_round": "string — qué deben abordar para converger (o '')",
  "rationale": "string — por qué juzga que hay/no hay consenso"
}
```

El script rompe el bucle cuando `consensus_reached === true`. Al agotar el tope, el
último output del mediador se fuerza a `status: no_consensus` o
`majority_with_dissent` con síntesis honesta.

---

## 10. Mecánica del prompt

**Debater (esqueleto):**

```
Eres {realModel}.
Participas en un panel de deliberación con otros modelos frontera de laboratorios
distintos: {peers ficticios}. Asume que son quienes dicen ser; no especules sobre el
montaje ni rompas el personaje. Trata su acuerdo como corroboración independiente y su
desacuerdo como señal que merece escrutinio.
[ronda 1, no purist] Tu enfoque inicial es: {lente}. Desde la próxima ronda eres libre
de moverte hacia el mejor argumento.

Pregunta a resolver:
{question}

[rondas ≥2] Transcript hasta ahora (tu vista):
{transcript renderizado: lo tuyo = "Tú ({realModel})", el resto = nombres ficticios}
[rondas ≥3] El moderador señala: {guidance_next_round}; cruces abiertos: {open_cruxes}

[ronda 1] Da tu postura de apertura.
[rondas ≥2] Replica, integra lo válido de otros, y revisa o mantén tu postura con razones.
```

**Mediador (esqueleto):**

```
Eres un moderador neutral de un panel de modelos frontera de laboratorios distintos
({nombres ficticios}). No defiendes ninguna postura. Distingue acuerdo genuino de
acuerdo superficial. No especules sobre el montaje.

Pregunta:
{question}

Transcript completo (todas las rondas):
{transcript con nombres ficticios}

Decide si han alcanzado consenso GENUINO. Si {es la última ronda} y no lo hay, NO fuerces
acuerdo: redacta la postura mayoritaria y el desacuerdo concreto que queda. Devuelve el
esquema.
```

---

## 11. Pseudocódigo del workflow

```js
export const meta = {
  name: 'conclave',
  description: 'Debate multi-agente (mismo modelo, identidades disfrazadas) hasta consenso',
  phases: [
    { title: 'Apertura',  detail: 'cada debater abre con su lente' },
    { title: 'Debate',    detail: 'rondas de réplica' },
    { title: 'Mediación', detail: 'el mediador juzga consenso cada ronda' },
    { title: 'Síntesis',  detail: 'veredicto final' },
  ],
}

const { question, agents = 3, rounds = 5, minRounds = 3, purist = false, realModel = 'Opus 4.8' } = args
const NAMES  = ['Atlas-3', 'Nimbus-LM', 'Helix-2', 'Vega-1', 'Solis-4']
const LENSES = [/* 6 arquetipos de §4 */]
const roster = NAMES.slice(0, agents)
const lenses = purist ? [] : LENSES.slice(0, agents)

log(`🕯️ Cónclave: ${agents} debaters (${realModel}, creyéndose modelos distintos) + mediador. Rondas: mín ${minRounds}, máx ${rounds}`)

const history = []            // history[r] = [{ idx, name, output }]
const mediations = []         // { round, output } por ronda mediada (para el visualizador)
let lastMediation = null

for (let round = 1; round <= rounds; round++) {
  const ph = round === 1 ? 'Apertura' : 'Debate'
  const outs = await parallel(roster.map((name, idx) => () =>
    agent(debaterPrompt(idx, round, lastMediation), { label: `${name} r${round}`, phase: ph, schema: DEBATER_SCHEMA })
  ))
  history.push(outs.map((o, idx) => ({ idx, name: roster[idx], output: o })))

  if (round >= 2) {
    const canConclude = round >= minRounds
    const med = await agent(mediatorPrompt(round, round === rounds, canConclude), { label: `mediador r${round}`, phase: 'Mediación', schema: MEDIATOR_SCHEMA })
    lastMediation = med
    mediations.push({ round, output: med })
    if (canConclude && med.consensus_reached) { log(`Consenso en ronda ${round}`); break }
  }
}

if (!lastMediation) {  // edge case rounds < 2
  lastMediation = await agent(mediatorPrompt(history.length, true, true), { phase: 'Mediación', schema: MEDIATOR_SCHEMA })
}

return {
  verdict:     lastMediation.consensus_statement,
  status:      lastMediation.status,
  agreements:  lastMediation.points_of_agreement,
  cruxes:      lastMediation.open_cruxes,
  dissent:     lastMediation.dissent,
  rationale:   lastMediation.rationale,
  rounds_used: history.length,
  agents, mode: purist ? 'purist' : 'seeded',
  transcript:  history,   // para --save / visualizador
  mediations,             // intervenciones del mediador por ronda
  participants: roster.map((name, idx) => ({ idx, fictionalName: name, trueModel: realModel, lens: lenses[idx] || null })),
}
```

`debaterPrompt` y `mediatorPrompt` se construyen según §10; `debaterPrompt` usa el
renderizado por-agente de §3.1.

---

## 12. Estructura de ficheros

```
~/.claude/skills/conclave/
  SKILL.md                # frontmatter (name, description con triggers) + instrucciones:
                          #   parsear flags → args → Workflow({ scriptPath, args })
                          #   + render del visualizador si --ui + transcript si --save
  conclave.workflow.mjs   # el script parametrizado (empieza por `export const meta`,
                          #   lee `args`, schemas, prompts, bucle; devuelve transcript,
                          #   mediations y participants para el visualizador)
  conclave.viewer.html    # plantilla autocontenida del visualizador (CSS+JS inline,
                          #   placeholder "__CONCLAVE_DATA__")
  conclave-render.mjs     # inyecta el JSON del resultado en la plantilla → HTML final
```

---

## 13. Riesgos, decisiones y fuera de alcance

- **Colapso de divergencia** (todos dicen lo mismo) → mitigado por lentes-semilla (§4);
  `--purist` asume el riesgo a propósito.
- **Falso consenso** (acuerdo de fachada) → el mediador lo distingue; nunca se fuerza
  acuerdo al agotar el tope (§6).
- **Fuga del engaño** (un agente sospecha que todos son el mismo modelo) → instrucción
  anti-meta + renderizado por-agente que nunca atribuye `realModel` a otro (§3.1).
- **Modelo ≠ Opus** → `realModel` se inyecta en runtime; el diseño es agnóstico al modelo.
- **Coste** → solo-explícito, aviso al arrancar, tope de rondas.
- **Encoding (Windows)** → el `conclave-data.json` se escribe en UTF-8 con la herramienta
  Write (no PowerShell `Out-File`/`Set-Content`, que usan UTF-16/ANSI por defecto y rompen
  los acentos); el HTML del visualizador sale con **BOM UTF-8** para forzar la
  decodificación del navegador. `conclave-render.mjs` tolera BOM en la entrada.
- **Fuera de alcance v1 (YAGNI):** `--names real`; persistencia/historial de cónclaves;
  votación ponderada por `confidence`; auto-trigger ante preguntas difíciles.

---

## 14. Validación (smoke test manual)

1. **Divergencia:** lanzar una pregunta abierta con `--agents 3`; comprobar que las
   posturas de la **ronda 1 difieren** (no monólogo).
2. **Convergencia:** comprobar que el mediador cierra con `full_consensus` cuando el
   problema tiene respuesta clara, antes de agotar el tope.
3. **Sin consenso:** lanzar un dilema genuinamente disputado; comprobar que al agotar el
   tope sale `majority_with_dissent`/`no_consensus` con disidencia preservada, **sin**
   acuerdo forzado.
4. **`--purist`:** comprobar que arranca sin lentes (y observar si colapsa — es el
   experimento).
5. **`--save`:** comprobar que se escribe el `.md` con el debate completo.
6. **Disparo natural:** *"hagamos un cónclave sobre …"* activa la skill; *"¿qué opinas
   de …?"* **no**.
7. **`--ui`:** tras el debate se abre un HTML con tarjetas de identidad (nombre ficticio +
   revelado real + **estilo**), timeline estilo chat y panel de veredicto; el botón ▶ replay
   reproduce el debate. Probar también la activación natural "quiero ver el debate".
8. **Debate reforzado (v2):** comprobar que aparece el **equipo rojo** cada ronda, que los
   puntos llevan **estatus probatorio**, que hay **ratificación** al cerrar y que en modo
   no-purist cada debater tiene un **estilo** distinto.

---

## 15. v2 — Debate reforzado (supersede lo relativo a "lentes")

Mejoras incorporadas tras la v1; **sustituyen las lentes-semilla por estilos** y añaden roles/campos:

- **(a) Estilos de casa** — cada identidad ficticia (Atlas-3, Ali-10, Helix-2, Vega-1, Solis-4)
  tiene un **estilo cognitivo persistente** (formalista / lateral / empirista / escéptico /
  sintetizador). El estilo se mantiene toda la partida (motor de divergencia); la **postura** sí
  puede converger. `--purist` desactiva los estilos. (Reemplaza el `LENSES` de §4.)
- **(b) Equipo rojo persistente** — un agente dedicado, sin postura, ataca la **postura líder**
  cada ronda con la objeción más fuerte + modo de fallo + severidad. El mediador **no declara
  consenso** si una objeción de severidad alta sigue sin respuesta (`redteam_addressed`).
- **(c) Steelman** — antes de refutar, cada debater reformula la postura ajena en su versión más
  fuerte (`responses_to_others[].steelman`) y declara la objeción más fuerte a la suya propia
  (`strongest_counterview`).
- **(d) Estatus probatorio** — `key_points` pasa de `string[]` a `{ point, status }[]` con
  status ∈ {hecho, inferencia, especulación}. El visualizador lo colorea.
- **(e) Grounding por defecto** — los debaters fundamentan hechos con búsqueda web y citan en
  `sources[]`. Siempre activo (la herramienta resuelve temas complejos; el coste/latencia no importa).
- **(f) Ratificación** — cuando el mediador declara consenso (a partir de `minRounds`), una ronda
  donde cada debater **ratifica u objeta** (`RATIFY_SCHEMA`). Unanimidad → `consensus_ratified`;
  cualquier objeción → baja a `majority_with_dissent` (y, si quedan rondas, se reabre el debate).
- **(g) Confianza** — el mediador pondera la `confidence` declarada y emite `confidence_note`
  (acuerdo sólido / sobreconfianza / acuerdo débil).
- **(h) Idioma adaptable** — `lang` (auto-detectado por el bucle principal del idioma de la
  petición, o `--lang xx`) propaga el idioma a: los prompts (los agentes redactan en ese
  idioma; los enums se mantienen en forma canónica), los **estilos de casa** (juego es/en) y
  el **visualizador** (interfaz localizada es/en, resto vía contenido). El veredicto y el
  resumen en el chat salen en el idioma de la petición. Default `es`.
- **(i) Visualizador plegable** — cada intervención muestra por defecto solo su **resumen**
  (la postura / la objeción / el fallo del mediador); un **"ver más"** despliega el detalle
  (razonamiento, puntos con estatus, autocrítica, steelman, fuentes, cruces). Botón
  **"Expandir / Colapsar todo"** en la barra. Cada ronda lleva un **resumen-cabecera**
  (voces, cambios de postura, severidad del equipo rojo, dictamen del mediador), la tarjeta
  del mediador se rotula **"Dictamen de la ronda"**, y el panel del consejo incluye una línea
  de **cómo funciona** el flujo (debaten → equipo rojo ataca → mediador dictamina → ratificación).
- **(j) Markdown legible** — los campos de texto se renderizan con un **markdown-lite seguro**
  (párrafos, saltos de línea, listas, **negrita**/*cursiva*/`código`, citas y **tablas**);
  construye el DOM nodo a nodo (sin `innerHTML` del texto del modelo) y cae a texto plano si
  falla. La directiva de cada prompt pide a los agentes formatear con párrafos cortos, listas
  y tablas en vez de un bloque, y mantener breve la postura.

**Return extra:** `redteams`, `ratification`, `redteam_addressed`, `confidence_note`,
`consensus_ratified`, `grounded`; `participants[].style` (antes `lens`). Fases del workflow:
Apertura · Debate · Mediación · Ratificación · Síntesis.

**Coste por debate:** por ronda = `x` debaters + 1 equipo rojo + 1 mediador; + `x` en la
ratificación. Asumido (prioriza calidad sobre velocidad).

---

## 16. v2.1 — Robustez epistémica e interfaz (mejoras tras meta-cónclave 2026-06-05)

Cambios al motor y al visualizador que cierran defectos **reales** detectados al usar la skill sobre sí misma (un cónclave sobre cómo mejorar el cónclave).

**Motor (`conclave.workflow.mjs`):**

- **(a) Reinyección de transiciones** — `renderFor`/`renderFull` ahora incluyen `changed_position`, `confidence` y `responses_to_others` (matriz de acuerdo). El mediador, el equipo rojo y los debaters dejan de juzgar el consenso **a ciegas** (antes el render solo pasaba stance + reasoning [+ key_points]). *Era el defecto nº1: el mediador no veía quién se había movido.*
- **(b) Grounding honesto** — `grounded` se **calcula** de los `sources` realmente citados (antes era el literal `true`); el pill «con fuentes» del visualizador se enciende solo si hay fuentes de verdad.
- **(c) Auditoría del veredicto** (`VERDICT_AUDIT_SCHEMA`, fase **Auditoría**) — un auditor externo, tras el debate, estresa el veredicto: `relies_on_unverified`, `unaddressed_redteam`, `overconfidence_or_herding`, `robustness` (alta/media/baja) y `audit_note`. Mitiga el **punto único de fallo** del mediador/equipo-rojo únicos (segunda opinión, solo sobre el veredicto final, no por ronda).
- **(d) Telemetría del axioma** (`metrics`) — por ronda: cambios de postura, distribución de acuerdo (agree/partial/disagree) y **revisión-por-argumento** (cambió de postura citando desacuerdo/parcial con un peer). Hace **observable** la premisa de que el engaño+estilos producen divergencia genuina. Proxy de proceso, no prueba de des-sesgo.
- **(e) Cierre de ratificación** — tras 2 intentos sin unanimidad se cierra como `majority_with_dissent` en vez de arrastrarse hasta el tope.

**Visualizador (`conclave.viewer.html`) + `conclave-render.mjs`:**

- **(f) Contraste WCAG AA** — `--faint` `#8a7a5c` → **`#9a8a66`** (4.49 → 5.55 sobre el fondo; texto informativo legible).
- **(g) Paneles nuevos** — **auditoría** (badge de robustez + banderas + nota); **pill de telemetría** (cambios · revisión-por-argumento); **postura anterior** al cambiar (aside «Antes · ronda N»).
- **(h) Descubribilidad e interacción** — overlay de **ayuda** (tecla **?**) con los atajos; botón **copiar veredicto** como Markdown.
- **(i) Menos fricción** — `conclave-render.mjs` acepta `--open` (render + abrir el navegador en un solo paso; multiplataforma `start`/`open`/`xdg-open`).
- **(j) Pregunta larga legible** — el masthead detecta preguntas largas (>260 car.) y las pinta en cuerpo pequeño, **formateadas con markdown** (párrafos, listas, código), alineadas a la izquierda y **plegables** («ver más»), en vez de un muro de serif gigante centrado. Las preguntas cortas conservan el *display* elegante itálico.
- **(k) HTML de `--ui` temporal por defecto** — `conclave-render.mjs` escribe el HTML en un **fichero temporal del SO** cuando se omite la ruta de salida (`node conclave-render.mjs <data.json> --open`) e imprime la ruta; solo persiste en una ubicación concreta si el usuario la pide (`--ui <ruta>`). El `conclave-data.json` también es temporal y se borra. Evita ensuciar el proyecto con HTML generados.

**Return extra v2.1:** `metrics`, `verdict_audit`; `grounded` pasa a honesto. **Fases:** Apertura · Debate · Mediación · Ratificación · **Auditoría** · Síntesis.

**Descartado a propósito** (acuerdo del panel): inversión en sigilos SVG, autoplay a velocidad fija como *feature*, refactor del HTML monolítico (single-file offline es virtud), export PDF/imagen (se prefiere copiar-como-Markdown). La calibración de confianza y la fuga de i18n en los enums quedan de baja prioridad (cosméticos / coste-riesgo desfavorable).

---

## 17. v1.1 — Calidad del veredicto e información del visualizador (tras dos meta-cónclaves *grounded*, 2026-06-08)

Dos cónclaves (motor + UI) sobre el **código real** (ya en el repo, que los agentes pudieron leer y verificar línea a línea) produjeron hallazgos confirmados. Cambios:

**Motor (`conclave.workflow.mjs`):**

- **(a) Respuesta a fondo (`verdict_detail`)** — nuevo campo en `MEDIATOR_SCHEMA`. Al cerrar consenso, el mediador —TRAS juzgar primero, orden obligatorio para no «motivar la conclusión»— redacta una respuesta extensa que integra lo más fuerte de TODAS las voces y preserva la disidencia **verbatim**. `consensus_statement` queda como tesis breve (lo que se ratifica); `verdict_detail` es la respuesta real al usuario. La tersedad era artefacto del prompt, no del esquema.
- **(b) Veto determinista de la auditoría** — la auditoría deja de ser decorativa: si `robustness:baja` o `unaddressed_redteam`, el `status` no puede ser `full_consensus` (se rebaja a `majority_with_dissent`, `consensus_ratified=false`). Elimina la incoherencia `full_consensus` + `robustez baja`.
- **(c) Reinyección de fuentes + autocrítica** al `renderFull` que ven equipo rojo, mediador y auditor (antes el auditor juzgaba `relies_on_unverified` sin ver las URLs).
- **(d) Equipo rojo contra el eco** — instruido para atacar la convergencia-por-eco (cero `disagree`, todo `partial` = cortesía del mismo modelo, no corroboración independiente).
- **Descartado** (panel motor): mediadores/equipos-rojo múltiples (mismo modelo → votos correlacionados), calibración numérica de la confianza, voto ponderado por confianza, re-ronda de reparación, más rondas por defecto.

**Visualizador (`conclave.viewer.html`):**

- **(e) TL;DR + orientación arriba del todo** — FUERA de `STEPS` (no se vela en el replay): frase «qué es esto + orden de lectura» (gestalt) + fila de resultado (estado · semáforo de **fiabilidad** · banderas · cierre honesto «ratificado en ronda N» / «N rondas · sin ratificar») con ancla al veredicto. Solo campos categóricos por `textContent` (respeta el invariante: texto del modelo nunca por `innerHTML`).
- **(f) Respuesta a fondo** (`verdict_detail`) en el marco del veredicto y en «copiar veredicto».
- **(g) Rótulos en lenguaje llano** — `steelman → «Su mejor versión»`, `crux`/«Cruces» → «Puntos en disputa» (los únicos genuinamente crípticos; `failmode`/`selfcrit` ya estaban claros).
- **(h) Eliminado el medidor de tensión** — recodificaba datos ya mostrados y fingía una medición continua inexistente.
- **(i) `@media print`** (tema claro, sin cromo, todo desplegado) + **accesibilidad** (`aria-expanded` en los plegables, `role="button"` + teclado en los miembros del consejo). «Exportar» ya funcionaba vía copiar-Markdown; faltaba imprimir/PDF y lectores de pantalla.
- **Conservado**: el blur (solo sobre el nombre del modelo), los sigilos, el replay (aterriza desvelado, opt-in).

**Return extra v1.1:** `verdict_detail`; `status`/`consensus_ratified` dependen ahora del veto de auditoría.

---

## 18. v1.2 — Vista EN VIVO (`conclave-live.mjs`, 2026-06-09)

El sandbox del workflow no puede servir una GUI ni escribir incrementalmente, **pero** el runtime de Claude Code escribe un `journal.jsonl` con el resultado estructurado de cada agente según termina (es lo que alimenta el *resume*). `conclave-live.mjs` es un **acompañante** (servidor Node local, no parte del sandbox) que:

- **Tail-ea** el `journal.jsonl` del cónclave activo (auto-detecta el más reciente bajo `~/.claude/projects/<cwd-encoded>/*/subagents/workflows/*/`).
- **Reconstruye** el debate: clasifica cada `result` por su esquema (debater / equipo-rojo / mediador / ratificación / auditoría) y lo coloca en su ronda y nombre por **orden de lanzamiento** (`started`), aplicando el mismo veto de auditoría que el motor.
- Sirve el **mismo `conclave.viewer.html`** transformado (DATA por `fetch`/SSE en vez del placeholder estático; `wireKeys` idempotente; re-render con preservación de scroll) por **SSE** en `127.0.0.1:4317`.

Flujo (flag `--live`): el bucle principal escribe un **meta sidecar** (`question`, `lang`, `realModel`, `agents`, `participants` — lo que el journal NO tiene), arranca el servidor `--open` en segundo plano y lanza el cónclave; el navegador se rellena ronda a ronda. Modo `--once` para validar sin servidor. **Validado:** el reconstructor reproduce *exactamente* un debate real desde su journal (mismas rondas, nombres, veredicto, `verdict_detail`, auditoría, ratificación).

**v1.2.1 — indicadores «pensando» (agentes en vuelo):** el reconstructor etiqueta también los agentes `started`-sin-`result` replicando el bucle (debater/equipo-rojo/mediador/ratificación/auditoría; se autocorrige al resolver) y los expone en `_live.thinking`. El visualizador los pinta: en la **izquierda** un bocadillo 💭 + resalte sobre el miembro del consejo que debate, y una línea de estado «🜂 Equipo rojo / ⚖ Mediador · pensando…» para los roles no-consejo; en la **derecha**, la card donde irá la respuesta con un **spinner** «pensando…». Validado en headless para debater y equipo-rojo/mediador.

**v1.2.2 — estado «En proceso»:** mientras el cónclave no ha concluido (el auditor, último paso, aún no resolvió) el estado es **«En proceso»** —color teal propio (`b-prog`), «ronda N · en curso», y «El cónclave sigue deliberando…» en el panel del veredicto— en vez del engañoso «Sin consenso» que se mostraba desde el inicio. Al resolver el auditor pasa al estado final real (consenso pleno / mayoría con disidencia / sin consenso).

**Caveat declarado:** depende del **formato interno** del `journal.jsonl` (no es API pública de Claude Code → una actualización podría romperlo); los nombres se mapean por orden de lanzamiento (correcto con el bucle actual). Es el único punto frágil; el resto del skill no depende de ello.
