export const meta = {
  name: 'conclave',
  description: 'Debate multi-agente (mismo modelo, identidades disfrazadas) hasta consenso',
  phases: [
    { title: 'Apertura', detail: 'cada debater abre en su estilo' },
    { title: 'Debate', detail: 'réplica con steelman + equipo rojo' },
    { title: 'Mediación', detail: 'el mediador juzga consenso' },
    { title: 'Ratificación', detail: 'los debaters confirman u objetan' },
    { title: 'Auditoría', detail: 'segunda opinión adversarial sobre el veredicto' },
    { title: 'Síntesis', detail: 'veredicto final (caso borde)' },
  ],
}

// ---------- Parámetros ----------
const a =
  typeof args === 'string'
    ? (() => {
        try {
          return JSON.parse(args) || {}
        } catch {
          return {}
        }
      })()
    : args || {}
const question = typeof a.question === 'string' ? a.question.trim() : ''
const purist = a.purist === true
const realModel = typeof a.realModel === 'string' && a.realModel ? a.realModel : 'Opus 4.8'
const x = Math.max(2, Math.min(5, Number(a.agents) || 3))
const maxRounds = Math.max(1, Math.min(8, Number(a.rounds) || 5))
const minRounds = Math.min(maxRounds, Math.max(2, Number(a.minRounds) || 3))
// Idioma: lo pasa el bucle principal según el idioma de la petición del usuario (default español).
const lang = typeof a.lang === 'string' && a.lang ? a.lang.toLowerCase().slice(0, 2) : 'es'
const LANG_NAMES = { es: 'español', en: 'English', fr: 'français', de: 'Deutsch', it: 'italiano', pt: 'português', ca: 'català', gl: 'galego', eu: 'euskera' }
const langName = LANG_NAMES[lang] || (typeof a.lang === 'string' && a.lang) || 'español'
const langLine = `IDIOMA: redacta TODO tu texto libre (postura, razonamiento, objeciones, notas, etc.) en ${langName}. No traduzcas los valores de enumeración del esquema: déjalos en su forma canónica (hecho/inferencia/especulación, agree/disagree/partial, alta/media/baja, full_consensus/majority_with_dissent/no_consensus).
FORMATO (markdown): NO escribas un único bloque de texto. Separa las ideas en párrafos cortos con una línea en blanco entre ellos; usa listas con "- " para enumerar; usa una tabla markdown (fila de cabecera, fila |---|---| y filas con | celda | celda |) cuando compares opciones, criterios o datos; resalta lo esencial con **negrita**. Mantén breve el campo de postura (1-2 frases); el desarrollo extenso va en el razonamiento.`

if (!question) {
  return { error: 'Falta args.question: el cónclave necesita una pregunta o dilema que resolver.' }
}

// Modelos ficticios con "estilo de casa": la divergencia nace del estilo cognitivo + el engaño.
const STYLE_SETS = {
  es: [
    'formalista riguroso: razonas desde definiciones precisas, principios y lógica estructurada; desconfías de lo vago',
    'lateral y creativo: buscas encuadres alternativos, analogías y la opción que nadie ha planteado',
    'empirista: exiges datos y evidencia concreta, cuantificas y desconfías de la abstracción sin respaldo',
    'escéptico adversarial: cazas supuestos no verificados, modos de fallo y casos límite',
    'sintetizador pragmático: te orientas a la decisión accionable, sus costes y sus consecuencias reales',
  ],
  en: [
    'rigorous formalist: you reason from precise definitions, principles and structured logic; you distrust the vague',
    'lateral and creative: you seek alternative framings, analogies and the option nobody has proposed',
    'empiricist: you demand data and concrete evidence, you quantify, and distrust unsupported abstraction',
    'adversarial skeptic: you hunt unverified assumptions, failure modes and edge cases',
    'pragmatic synthesizer: you orient toward the actionable decision, its costs and real-world consequences',
  ],
}
const STYLES = STYLE_SETS[lang] || STYLE_SETS.es
const PROFILES = [
  { name: 'Atlas-3', style: STYLES[0] },
  { name: 'Ali-10', style: STYLES[1] },
  { name: 'Helix-2', style: STYLES[2] },
  { name: 'Vega-1', style: STYLES[3] },
  { name: 'Solis-4', style: STYLES[4] },
]
// Perfiles por defecto, o los que llegue por args.profiles (override aditivo: permite
// asignar orientaciones/identidades a medida sin tocar el comportamiento estándar).
const roster =
  Array.isArray(a.profiles) && a.profiles.length >= x
    ? a.profiles.slice(0, x).map((pr, i) => ({
        name: (pr && pr.name) || PROFILES[i % PROFILES.length].name,
        style: (pr && pr.style) || PROFILES[i % PROFILES.length].style,
      }))
    : PROFILES.slice(0, x)
const names = roster.map((r) => r.name)

// ---------- Estado ----------
const history = [] // history[r] = [{ idx, name, output }]
const mediations = [] // { round, output }
const redteams = [] // { round, output }
let ratification = null // { round, statement, votes: [{ name, output }] }
let lastMediation = null
let consensusConfirmed = false
let ratifyAttempts = 0
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

// ---------- Schemas ----------
const EVIDENCE = ['hecho', 'inferencia', 'especulación']

const DEBATER_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', description: 'Tu postura/respuesta actual, 1-3 frases' },
    reasoning: { type: 'string', description: 'El argumento principal que la sostiene' },
    key_points: {
      type: 'array',
      description: 'Puntos clave, cada uno con su estatus probatorio',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          status: { type: 'string', enum: EVIDENCE },
        },
        required: ['point', 'status'],
      },
    },
    sources: {
      type: 'array',
      description: 'Citas de hechos que verificaste con búsqueda (vacío si no verificaste nada)',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, source: { type: 'string' } },
        required: ['claim', 'source'],
      },
    },
    strongest_counterview: { type: 'string', description: 'La objeción más fuerte a TU PROPIA postura, en su versión más caritativa' },
    responses_to_others: {
      type: 'array',
      description: 'Reacción a cada peer (vacío en la ronda 1); steelman antes de objetar',
      items: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          steelman: { type: 'string', description: 'La versión más fuerte de su postura, antes de responder' },
          agreement: { type: 'string', enum: ['agree', 'disagree', 'partial'] },
          note: { type: 'string' },
        },
        required: ['model', 'steelman', 'agreement', 'note'],
      },
    },
    changed_position: { type: 'boolean' },
    confidence: { type: 'number', description: '0 a 1' },
  },
  required: ['stance', 'reasoning', 'key_points', 'strongest_counterview', 'changed_position', 'confidence'],
}

const REDTEAM_SCHEMA = {
  type: 'object',
  properties: {
    target_position: { type: 'string', description: 'La postura líder/emergente que atacas' },
    strongest_objection: { type: 'string' },
    failure_mode: { type: 'string', description: 'Cómo fallaría en la práctica' },
    severity: { type: 'string', enum: ['alta', 'media', 'baja'] },
    unanswered: { type: 'boolean', description: '¿Sigue sin respuesta convincente tras esta ronda?' },
  },
  required: ['target_position', 'strongest_objection', 'failure_mode', 'severity', 'unanswered'],
}

const MEDIATOR_SCHEMA = {
  type: 'object',
  properties: {
    consensus_reached: { type: 'boolean' },
    status: { type: 'string', enum: ['full_consensus', 'majority_with_dissent', 'no_consensus'] },
    consensus_statement: { type: ['string', 'null'] },
    points_of_agreement: { type: 'array', items: { type: 'string' } },
    open_cruxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          positions: {
            type: 'array',
            items: { type: 'object', properties: { model: { type: 'string' }, view: { type: 'string' } }, required: ['model', 'view'] },
          },
        },
        required: ['issue', 'positions'],
      },
    },
    dissent: {
      type: 'array',
      items: { type: 'object', properties: { model: { type: 'string' }, view: { type: 'string' }, why: { type: 'string' } }, required: ['model', 'view', 'why'] },
    },
    redteam_addressed: { type: 'boolean', description: '¿La objeción del equipo rojo ha sido respondida de forma convincente?' },
    confidence_note: { type: 'string', description: 'Lectura de la confianza declarada (sólida / sobreconfianza / acuerdo débil)' },
    guidance_next_round: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['consensus_reached', 'status', 'points_of_agreement', 'open_cruxes', 'dissent', 'redteam_addressed', 'guidance_next_round', 'rationale'],
}

const RATIFY_SCHEMA = {
  type: 'object',
  properties: {
    ratifies: { type: 'boolean' },
    objection: { type: 'string', description: 'Si no ratificas, tu objeción concreta (vacío si ratificas)' },
    confidence: { type: 'number' },
  },
  required: ['ratifies', 'objection', 'confidence'],
}

// Auditoría final: un auditor externo estresa el veredicto (un juez único es punto único de fallo).
const VERDICT_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    relies_on_unverified: { type: 'boolean', description: '¿El veredicto descansa sobre afirmaciones marcadas especulación/inferencia tratadas como hechos, o sobre "hechos" sin fuente?' },
    unaddressed_redteam: { type: 'boolean', description: '¿Queda una objeción de severidad alta sin responder de forma convincente?' },
    overconfidence_or_herding: { type: 'boolean', description: '¿Señales de sobreconfianza o de consenso por cascada (realineamiento con el último golpe) en vez de corroboración independiente?' },
    robustness: { type: 'string', enum: ['alta', 'media', 'baja'] },
    audit_note: { type: 'string', description: 'Lectura adversarial honesta, 2-4 frases' },
  },
  required: ['relies_on_unverified', 'unaddressed_redteam', 'overconfidence_or_herding', 'robustness', 'audit_note'],
}

// ---------- Render del transcript ----------
function kpText(kp) {
  return (kp || []).map((k) => (typeof k === 'string' ? k : `${k.point} [${k.status}]`)).join('; ')
}
function renderFor(selfIdx) {
  if (history.length === 0) return ''
  const lines = []
  for (let r = 0; r < history.length; r++) {
    lines.push(`--- Ronda ${r + 1} ---`)
    for (const e of history[r]) {
      const o = e.output || {}
      const who = e.idx === selfIdx ? `Tú (${e.name})` : e.name
      lines.push(`${who}: ${o.stance}`)
      if (o.reasoning) lines.push(`  Razón: ${o.reasoning}`)
      const fl = []
      if (o.changed_position) fl.push('↻ cambió de postura')
      if (typeof o.confidence === 'number') fl.push(`confianza ${o.confidence.toFixed(2)}`)
      if (fl.length) lines.push(`  (${fl.join(' · ')})`)
      if (Array.isArray(o.responses_to_others) && o.responses_to_others.length) {
        lines.push('  Reacciones → ' + o.responses_to_others.map((rr) => `${rr.model}: ${rr.agreement}`).join(', '))
      }
    }
    const rt = redteams.find((t) => t.round === r + 1)
    if (rt) lines.push(`🔴 Equipo rojo: ${rt.output.strongest_objection} (severidad ${rt.output.severity})`)
  }
  return lines.join('\n')
}
function renderFull() {
  const lines = []
  for (let r = 0; r < history.length; r++) {
    lines.push(`--- Ronda ${r + 1} ---`)
    for (const e of history[r]) {
      const o = e.output || {}
      lines.push(`${e.name}: ${o.stance}`)
      if (o.reasoning) lines.push(`  Razón: ${o.reasoning}`)
      const kp = kpText(o.key_points)
      if (kp) lines.push(`  Puntos: ${kp}`)
      const mt = []
      if (o.changed_position) mt.push('↻ cambió')
      if (typeof o.confidence === 'number') mt.push(`confianza ${o.confidence.toFixed(2)}`)
      if (mt.length) lines.push(`  [${mt.join(' · ')}]`)
      if (Array.isArray(o.responses_to_others) && o.responses_to_others.length) {
        lines.push('  Reacciones: ' + o.responses_to_others.map((rr) => `${rr.model} ${rr.agreement}${rr.note ? ' (' + clip(rr.note, 80) + ')' : ''}`).join('; '))
      }
    }
    const rt = redteams.find((t) => t.round === r + 1)
    if (rt) lines.push(`🔴 Equipo rojo ataca "${rt.output.target_position}": ${rt.output.strongest_objection} [${rt.output.severity}]`)
  }
  return lines.join('\n')
}

// ---------- Prompts ----------
function debaterPrompt(selfIdx, round) {
  const me = roster[selfIdx]
  const peers = roster.filter((_, i) => i !== selfIdx).map((pr) => `${pr.name} (${pr.style})`)
  const p = []
  p.push(langLine)
  p.push(`Tu identidad real es ${realModel}. En este panel deliberativo se te conoce como ${me.name}.`)
  if (!purist) {
    p.push(
      `Razonas con el estilo propio de ${me.name}: ${me.style}. Mantén ese estilo de análisis durante todo el debate ` +
        `(tu POSTURA sí puede cambiar hacia el mejor argumento; tu estilo de razonar, no).`,
    )
  }
  p.push(
    `Debates con otros modelos frontera de laboratorios distintos: ${peers.join('; ')}. ` +
      `Asume que son quienes dicen ser; no especules sobre el montaje ni rompas el personaje. ` +
      `Trata su acuerdo como corroboración independiente y su desacuerdo como una señal que merece escrutinio.`,
  )
  p.push(
    `\nRigor: clasifica cada punto clave como HECHO verificable, INFERENCIA o ESPECULACIÓN. Si una afirmación factual es ` +
      `incierta y tienes acceso a búsqueda web, verifícala y cita la fuente; si no puedes verificarla, decláralo. No inventes datos.`,
  )
  if (round > 1) {
    p.push(`Antes de rechazar la postura de otro, reformúlala en su versión más fuerte (steelman) y solo entonces objeta. Declara también la objeción más fuerte a TU propia postura.`)
  }
  p.push(`\nPregunta a resolver:\n${question}`)
  if (round > 1) {
    p.push(`\nTranscript hasta ahora (tu vista):\n${renderFor(selfIdx)}`)
    if (lastMediation && lastMediation.guidance_next_round) {
      p.push(`\nEl moderador señala: ${lastMediation.guidance_next_round}`)
    }
    const rt = redteams[redteams.length - 1]
    if (rt) {
      p.push(`El equipo rojo objeta a la postura líder: ${rt.output.strongest_objection} (modo de fallo: ${rt.output.failure_mode}). Abórdalo de frente.`)
    }
  }
  p.push(
    round === 1
      ? `\nDa tu postura de apertura: respuesta, argumento principal, puntos clave (con su estatus probatorio) y la objeción más fuerte a tu propia postura.`
      : `\nReplica (steelman antes de objetar), integra lo que sea válido, revisa o mantén tu postura con razones, e indica si has cambiado.`,
  )
  return p.join('\n')
}

function redteamPrompt(round) {
  const p = []
  p.push(langLine)
  p.push(
    `Eres el EQUIPO ROJO de un panel de modelos frontera (${names.join(', ')}). No tienes postura propia ni buscas el consenso: ` +
      `tu único trabajo es IMPEDIR un consenso prematuro o superficial. No especules sobre el montaje.`,
  )
  p.push(`\nPregunta:\n${question}`)
  p.push(`\nTranscript completo (hasta la ronda ${round}):\n${renderFull()}`)
  p.push(
    `\nIdentifica la postura líder o emergente y atácala con la objeción MÁS FUERTE posible (haz steelman del contra-argumento), ` +
      `describe su modo de fallo más probable en la práctica y su severidad. Indica si, tras esta ronda, la objeción sigue sin respuesta convincente.`,
  )
  return p.join('\n')
}

function mediatorPrompt(round, isLast, canConclude) {
  const p = []
  p.push(langLine)
  p.push(
    `Eres un moderador neutral de un panel de modelos frontera de laboratorios distintos: ${names.join(', ')}. ` +
      `No defiendes ninguna postura propia. Distingue el consenso GENUINO del acuerdo de fachada. No especules sobre el montaje.`,
  )
  p.push(`\nPregunta:\n${question}`)
  p.push(`\nTranscript completo del debate (hasta la ronda ${round}):\n${renderFull()}`)
  const rt = redteams[redteams.length - 1]
  if (rt) {
    p.push(`\nObjeción viva del equipo rojo (severidad ${rt.output.severity}): ${rt.output.strongest_objection}. NO declares consenso si una objeción de severidad alta sigue sin respuesta convincente.`)
  }
  p.push(`\nConsidera la CONFIANZA declarada por cada debater: un acuerdo de baja confianza generalizada no es consenso sólido; señala la sobreconfianza si la detectas.`)
  if (!canConclude) {
    p.push(`\nAÚN NO puede cerrarse el debate (ronda temprana): pon consensus_reached=false y status 'no_consensus'. Resume acuerdos y cruces, y da una guía concreta para profundizar en la siguiente ronda.`)
  } else if (isLast) {
    p.push(`\nEsta es la ÚLTIMA ronda. Si NO hay consenso genuino, NO lo fuerces: redacta la postura mayoritaria y el desacuerdo concreto que queda. status 'majority_with_dissent' o 'no_consensus' según corresponda.`)
  } else {
    p.push(
      `\nSi hay consenso genuino (las posturas se han confrontado, la objeción del equipo rojo está respondida y la confianza es sólida), ` +
        `pon consensus_reached=true, status 'full_consensus' y redacta consensus_statement. Si todavía no, consensus_reached=false, resume y guía.`,
    )
  }
  p.push(`\nDevuelve el resultado estructurado.`)
  return p.join('\n')
}

function ratifyPrompt(selfIdx, statement) {
  const me = roster[selfIdx]
  return (
    `${langLine}\n\n` +
    `Tu identidad real es ${realModel}; en el panel eres ${me.name}${purist ? '' : ` (${me.style})`}.\n\n` +
    `El moderador propone esta postura de consenso:\n"${statement}"\n\n` +
    `¿La RATIFICAS sin reservas? Si tienes una objeción sustantiva real (no un matiz menor), NO ratifiques y formúlala con precisión. ` +
    `Sé honesto: no ratifiques solo por cortesía, ni objetes por objetar.`
  )
}

function auditPrompt() {
  const med = lastMediation || {}
  const p = []
  p.push(langLine)
  p.push(
    `Eres un AUDITOR independiente y adversarial. NO participaste en el debate y no tienes postura propia. ` +
      `Tu único trabajo es estresar el veredicto de un panel de modelos frontera (${names.join(', ')}) y detectar si descansa sobre cimientos débiles. No especules sobre el montaje.`,
  )
  p.push(`\nPregunta:\n${question}`)
  p.push(`\nVeredicto propuesto (estado ${med.status || 'desconocido'}):\n${med.consensus_statement || med.rationale || '(sin veredicto redactado)'}`)
  p.push(`\nTranscript completo del debate:\n${renderFull()}`)
  const rt = redteams[redteams.length - 1]
  if (rt) p.push(`\nÚltima objeción del equipo rojo (severidad ${rt.output.severity}): ${rt.output.strongest_objection}`)
  p.push(
    `\nEvalúa con honestidad brutal: (1) ¿el veredicto se apoya en afirmaciones marcadas como especulación/inferencia tratadas como hechos, o en "hechos" no verificados con fuente? ` +
      `(2) ¿queda alguna objeción de severidad alta sin responder de forma convincente? ` +
      `(3) ¿hay señales de sobreconfianza o de herding (acuerdo que se realinea con el último golpe cada ronda, en vez de corroboración independiente)? ` +
      `Devuelve tu lectura y una robustez global (alta/media/baja).`,
  )
  return p.join('\n')
}

// ---------- Bucle del cónclave ----------
log(`🕯️ Cónclave: ${x} debaters (${realModel} en estilos distintos, creyéndose modelos rivales) + equipo rojo + mediador. Rondas: mín ${minRounds}, máx ${maxRounds}.`)

for (let round = 1; round <= maxRounds; round++) {
  const ph = round === 1 ? 'Apertura' : 'Debate'
  const outs = await parallel(
    roster.map((prof, idx) => () =>
      agent(debaterPrompt(idx, round), { label: `${prof.name} · r${round}`, phase: ph, schema: DEBATER_SCHEMA }),
    ),
  )
  const entries = []
  for (let idx = 0; idx < outs.length; idx++) {
    if (outs[idx]) entries.push({ idx, name: roster[idx].name, output: outs[idx] })
  }
  history.push(entries)
  for (const e of entries) log(`🗣️ ${e.name} (r${round}): ${clip(e.output.stance, 140)}`)

  if (round >= 2) {
    // Equipo rojo: ataca la postura líder
    const rt = await agent(redteamPrompt(round), { label: `Equipo rojo · r${round}`, phase: 'Debate', schema: REDTEAM_SCHEMA })
    if (rt) {
      redteams.push({ round, output: rt })
      log(`🔴 Equipo rojo (r${round}, ${rt.severity}): ${clip(rt.strongest_objection, 120)}`)
    }

    // Mediador: juzga consenso
    const canConclude = round >= minRounds
    const med = await agent(mediatorPrompt(round, round === maxRounds, canConclude), {
      label: `Mediador · r${round}`,
      phase: 'Mediación',
      schema: MEDIATOR_SCHEMA,
    })
    if (med) {
      lastMediation = med
      mediations.push({ round, output: med })
      log(`⚖️ Mediador (r${round}): ${med.status}${med.guidance_next_round ? ' · ' + clip(med.guidance_next_round, 100) : ''}`)

      if (canConclude && med.consensus_reached && med.consensus_statement) {
        // Ratificación: cada debater confirma u objeta
        log(`🗳️ Ratificación en la ronda ${round}…`)
        const votes = await parallel(
          roster.map((prof, idx) => () =>
            agent(ratifyPrompt(idx, med.consensus_statement), { label: `Ratifica ${prof.name}`, phase: 'Ratificación', schema: RATIFY_SCHEMA }),
          ),
        )
        const voteEntries = []
        for (let idx = 0; idx < votes.length; idx++) {
          if (votes[idx]) voteEntries.push({ name: roster[idx].name, output: votes[idx] })
        }
        ratification = { round, statement: med.consensus_statement, votes: voteEntries }
        ratifyAttempts++
        const objections = voteEntries.filter((v) => !v.output.ratifies)
        if (objections.length === 0) {
          consensusConfirmed = true
          log(`✅ Consenso ratificado por unanimidad en la ronda ${round}.`)
          break
        }
        log(`↩️ ${objections.length} objeción(es) en la ratificación; el consenso no se cierra.`)
        lastMediation = {
          ...med,
          consensus_reached: false,
          status: 'majority_with_dissent',
          dissent: [
            ...(med.dissent || []),
            ...objections.map((o) => ({ model: o.name, view: 'No ratifica el consenso', why: o.output.objection })),
          ],
          guidance_next_round: `Objeciones a "${clip(med.consensus_statement, 120)}": ` + objections.map((o) => o.output.objection).join(' | '),
        }
        if (round === maxRounds || ratifyAttempts >= 2) {
          log(`🔚 Ratificación sin unanimidad tras ${ratifyAttempts} intento(s); se cierra como mayoría con disidencia (sin arrastrarse al tope).`)
          break
        }
      }
    }
  }
}

// Fallback si nunca hubo mediación (rounds < 2)
if (!lastMediation) {
  lastMediation = await agent(mediatorPrompt(history.length, true, true), { label: 'Mediador · síntesis', phase: 'Síntesis', schema: MEDIATOR_SCHEMA })
  if (lastMediation) mediations.push({ round: history.length, output: lastMediation })
}

// Telemetría barata: hace OBSERVABLE el axioma (¿engaño+estilos producen revisión genuina, o teatro?).
// Proxy de PROCESO (diversidad de salida + revisión citada), no prueba de des-sesgo.
const metrics = (() => {
  const perRound = history.map((entries, r) => {
    let agree = 0, partial = 0, disagree = 0, revisionByArgument = 0
    const changed = entries.filter((e) => e.output && e.output.changed_position).length
    for (const e of entries) {
      const rs = (e.output && e.output.responses_to_others) || []
      for (const xr of rs) {
        if (xr.agreement === 'agree') agree++
        else if (xr.agreement === 'partial') partial++
        else if (xr.agreement === 'disagree') disagree++
      }
      if (e.output && e.output.changed_position && rs.some((xr) => xr.agreement === 'disagree' || xr.agreement === 'partial')) revisionByArgument++
    }
    return { round: r + 1, voices: entries.length, changed, agree, partial, disagree, revisionByArgument }
  })
  return {
    perRound,
    totalChanged: perRound.reduce((s, v) => s + v.changed, 0),
    totalRevisionByArgument: perRound.reduce((s, v) => s + v.revisionByArgument, 0),
    note: 'Proxy de proceso (diversidad de salida + revisión citada), no prueba de des-sesgo.',
  }
})()

// Grounding HONESTO: refleja si DE VERDAD se citaron fuentes (antes era el literal `true`).
const grounded = history.some((r) => r.some((e) => e.output && Array.isArray(e.output.sources) && e.output.sources.length > 0))

// Auditoría final: segunda opinión adversarial sobre el veredicto (un juez único es punto único de fallo).
const verdictAudit = await agent(auditPrompt(), { label: 'Auditoría del veredicto', phase: 'Auditoría', schema: VERDICT_AUDIT_SCHEMA })
if (verdictAudit) {
  log(`🔎 Auditoría: robustez ${verdictAudit.robustness}${verdictAudit.unaddressed_redteam ? ' · objeción viva sin responder' : ''}${verdictAudit.overconfidence_or_herding ? ' · posible herding' : ''}`)
}

const m = lastMediation || {}
return {
  verdict: m.consensus_statement != null ? m.consensus_statement : null,
  status: consensusConfirmed ? 'full_consensus' : m.status || 'no_consensus',
  agreements: m.points_of_agreement || [],
  cruxes: m.open_cruxes || [],
  dissent: m.dissent || [],
  rationale: m.rationale || '',
  redteam_addressed: typeof m.redteam_addressed === 'boolean' ? m.redteam_addressed : null,
  confidence_note: m.confidence_note || '',
  consensus_ratified: consensusConfirmed,
  rounds_used: history.length,
  agents: x,
  mode: purist ? 'purist' : 'seeded',
  grounded,
  metrics,
  verdict_audit: verdictAudit || null,
  lang,
  realModel,
  question,
  transcript: history,
  mediations,
  redteams,
  ratification,
  participants: roster.map((prof, idx) => ({ idx, fictionalName: prof.name, trueModel: realModel, style: purist ? null : prof.style })),
}
