// conclave-live.mjs — vista EN VIVO del cónclave.
//
// El sandbox del workflow no puede servir nada, pero el runtime de Claude Code escribe un
// `journal.jsonl` que va soltando el resultado estructurado de cada agente según termina.
// Este acompañante lo TAIL-ea, reconstruye el debate (clasificando cada salida por su esquema
// y colocándola en su ronda) y sirve el MISMO visualizador (conclave.viewer.html) por SSE,
// de modo que el navegador se rellena ronda a ronda casi en directo.
//
// Uso:
//   node conclave-live.mjs [--port 4317] [--meta <meta.json>] [--journal <journal.jsonl|auto>] [--open]
//   node conclave-live.mjs --once --journal <journal.jsonl> [--meta <meta.json>]   (valida sin servidor)
//
// `meta.json` (lo escribe el bucle principal al lanzar): { question, lang, realModel, agents, mode, participants:[{idx,fictionalName,trueModel,style}] }
// NOTA: depende del formato interno del journal de Claude Code (no es una API pública).

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : d) }
const PORT = Number(flag('--port', 4317)) || 4317
const ONCE = argv.includes('--once')
const OPEN = argv.includes('--open')
const METAP = flag('--meta', join(process.env.TEMP || '/tmp', 'conclave-live-meta.json'))
const JOURNAL_ARG = flag('--journal', 'auto')

// ---------- localizar el journal del cónclave activo ----------
function projectBase() {
  return join(homedir(), '.claude', 'projects', process.cwd().replace(/[\\/:]/g, '-'))
}
function findJournal() {
  if (JOURNAL_ARG && JOURNAL_ARG !== 'auto') return existsSync(JOURNAL_ARG) ? JOURNAL_ARG : null
  const base = projectBase()
  let best = null, bestM = -1
  let sessions = []
  try { sessions = readdirSync(base) } catch { return null }
  for (const s of sessions) {
    const wfDir = join(base, s, 'subagents', 'workflows')
    let wfs = []
    try { wfs = readdirSync(wfDir) } catch { continue }
    for (const wf of wfs) {
      const j = join(wfDir, wf, 'journal.jsonl')
      try { const m = statSync(j).mtimeMs; if (m > bestM) { bestM = m; best = j } } catch {}
    }
  }
  return best
}
function readMeta() { try { return JSON.parse(readFileSync(METAP, 'utf8')) } catch { return {} } }

// ---------- reconstrucción journal → datos del visualizador ----------
function classify(r) {
  if (!r || typeof r !== 'object') return null
  if ('robustness' in r && 'relies_on_unverified' in r) return 'audit'
  if ('ratifies' in r) return 'ratify'
  if ('consensus_reached' in r) return 'mediator'
  if ('target_position' in r && 'strongest_objection' in r) return 'redteam'
  if ('stance' in r && 'key_points' in r) return 'debater'
  return null
}
function computeMetrics(history) {
  const perRound = history.map((entries, r) => {
    let agree = 0, partial = 0, disagree = 0, rev = 0
    const changed = (entries || []).filter((e) => e.output && e.output.changed_position).length
    for (const e of entries || []) {
      const rs = (e.output && e.output.responses_to_others) || []
      for (const x of rs) { if (x.agreement === 'agree') agree++; else if (x.agreement === 'partial') partial++; else if (x.agreement === 'disagree') disagree++ }
      if (e.output && e.output.changed_position && rs.some((x) => x.agreement === 'disagree' || x.agreement === 'partial')) rev++
    }
    return { round: r + 1, voices: (entries || []).length, changed, agree, partial, disagree, revisionByArgument: rev }
  })
  return { perRound, totalChanged: perRound.reduce((s, v) => s + v.changed, 0), totalRevisionByArgument: perRound.reduce((s, v) => s + v.revisionByArgument, 0), note: 'Proxy de proceso.' }
}
// Replica el bucle del cónclave para asignar rol/ronda/idx a CADA agente lanzado (resuelto o EN VUELO).
// Para resueltos el resultado real manda; para en-vuelo es la mejor estimación (se autocorrige al resolver).
function assignSlots(started, res, x) {
  const slots = []
  let i = 0, round = 1
  while (i < started.length) {
    for (let k = 0; k < x && i < started.length; k++) slots.push({ id: started[i++], role: 'debater', round, idx: k })
    if (round >= 2) {
      if (i < started.length) slots.push({ id: started[i++], role: 'redteam', round })
      let medId = null
      if (i < started.length) { medId = started[i]; slots.push({ id: started[i++], role: 'mediator', round }) }
      const med = medId ? res[medId] : null
      if (med && med.consensus_reached) for (let k = 0; k < x && i < started.length; k++) slots.push({ id: started[i++], role: 'ratify', round, idx: k })
    }
    round++
  }
  // El auditor es el agente FINAL tras el bucle: un 'debater idx 0' huérfano (sin compañeros) o con esquema de auditoría.
  const last = slots[slots.length - 1]
  if (last) {
    const lr = res[last.id], prev = slots[slots.length - 2]
    const lone = last.role === 'debater' && last.idx === 0 && !(prev && prev.role === 'debater' && prev.round === last.round)
    if ((lr && classify(lr) === 'audit') || (!lr && lone)) last.role = 'audit'
  }
  return slots
}
function reconstruct(text, meta) {
  const started = [], res = {}
  for (const ln of text.split('\n')) {
    if (!ln.trim()) continue
    let e; try { e = JSON.parse(ln) } catch { continue }
    if (e.type === 'started' && e.agentId) { if (!started.includes(e.agentId)) started.push(e.agentId) }
    else if (e.type === 'result' && e.agentId) res[e.agentId] = e.result
  }
  const x = Math.max(1, Number(meta.agents) || 3)
  const DEF = ['Atlas-3', 'Ali-10', 'Helix-2', 'Vega-1', 'Solis-4']
  const parts = (Array.isArray(meta.participants) && meta.participants.length)
    ? meta.participants
    : Array.from({ length: x }, (_, i) => ({ idx: i, fictionalName: DEF[i] || 'Voz-' + (i + 1), trueModel: meta.realModel || 'Opus 4.8', style: null }))
  const nameAt = (i) => (parts[i] && parts[i].fictionalName) || 'Voz-' + (i + 1)

  const slots = assignSlots(started, res, x)
  const transcript = [], redteams = [], mediations = [], thinking = []
  let ratification = null, audit = null
  for (const s of slots) {
    const r = res[s.id], pend = !r
    if (s.role === 'debater') {
      const ri = s.round - 1; if (!transcript[ri]) transcript[ri] = []
      transcript[ri][s.idx] = { idx: s.idx, name: nameAt(s.idx), output: r || {}, thinking: pend }
      if (pend) thinking.push({ role: 'debater', round: s.round, idx: s.idx, name: nameAt(s.idx) })
    } else if (s.role === 'redteam') {
      redteams.push({ round: s.round, output: r || {}, thinking: pend }); if (pend) thinking.push({ role: 'redteam', round: s.round })
    } else if (s.role === 'mediator') {
      mediations.push({ round: s.round, output: r || {}, thinking: pend }); if (pend) thinking.push({ role: 'mediator', round: s.round })
    } else if (s.role === 'ratify') {
      if (!ratification) ratification = { round: s.round, statement: null, votes: [] }
      ratification.votes[s.idx] = { name: nameAt(s.idx), output: r || {}, thinking: pend }
      if (pend) thinking.push({ role: 'ratify', round: s.round, idx: s.idx, name: nameAt(s.idx) })
    } else if (s.role === 'audit') {
      if (r) audit = r; else thinking.push({ role: 'audit' })
    }
  }
  // rellena cualquier hueco de array (idx que aún no apareció) con placeholder "pensando"
  for (const arr of transcript) if (arr) for (let k = 0; k < x; k++) if (!arr[k]) arr[k] = { idx: k, name: nameAt(k), output: {}, thinking: true }
  if (ratification) for (let k = 0; k < ratification.votes.length; k++) if (!ratification.votes[k]) ratification.votes[k] = { name: nameAt(k), output: {}, thinking: true }

  const resolvedMeds = mediations.filter((md) => !md.thinking && md.output && md.output.consensus_reached !== undefined)
  const m = resolvedMeds.length ? resolvedMeds[resolvedMeds.length - 1].output : {}
  if (ratification) ratification.statement = m.consensus_statement || ratification.statement || null
  const auditVeto = !!(audit && (audit.robustness === 'baja' || audit.unaddressed_redteam))
  const allRatify = !!(ratification && ratification.votes.length >= x && ratification.votes.every((v) => v.output && v.output.ratifies))
  const finalRatified = !!(m.consensus_reached && allRatify && !auditVeto)
  const grounded = transcript.some((r) => (r || []).some((e) => e.output && Array.isArray(e.output.sources) && e.output.sources.length))
  const concluded = !!audit // el auditor es el ÚLTIMO paso: si ya resolvió, el cónclave terminó; si no, sigue EN PROCESO

  return {
    verdict: m.consensus_statement != null ? m.consensus_statement : null,
    verdict_detail: m.verdict_detail != null && m.verdict_detail !== '' ? m.verdict_detail : null,
    status: concluded ? (finalRatified ? 'full_consensus' : (m.status || 'no_consensus')) : (transcript.length ? 'en_proceso' : null),
    agreements: m.points_of_agreement || [], cruxes: m.open_cruxes || [], dissent: m.dissent || [],
    rationale: m.rationale || '', redteam_addressed: typeof m.redteam_addressed === 'boolean' ? m.redteam_addressed : null,
    confidence_note: m.confidence_note || '', consensus_ratified: finalRatified,
    rounds_used: transcript.length, agents: x, mode: meta.mode || 'seeded', grounded,
    metrics: computeMetrics(transcript), verdict_audit: audit || null,
    lang: meta.lang || 'es', realModel: meta.realModel || 'Opus 4.8', question: meta.question || '',
    transcript, mediations, redteams, ratification, participants: parts,
    _live: { pending: started.filter((id) => !(id in res)).length, results: Object.keys(res).length, started: started.length, thinking, concluded },
  }
}
function snapshot() {
  const j = findJournal()
  const meta = readMeta()
  if (!j) return { ...reconstruct('', meta), _live: { pending: 0, results: 0, started: 0, waiting: true } }
  let text = ''; try { text = readFileSync(j, 'utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) } catch {}
  return reconstruct(text, meta)
}

// ---------- modo --once: valida e imprime, sin servidor ----------
if (ONCE) {
  const d = snapshot()
  const L = console.log
  L('rondas:', d.rounds_used, '| agents:', d.agents, '| status:', d.status, '| ratified:', d.consensus_ratified, '| en vuelo:', d._live.pending)
  d.transcript.forEach((r, i) => L(`  ronda ${i + 1}: [${(r || []).map((e) => e.name).join(', ')}]` + (d.redteams.find((t) => t.round === i + 1) ? ' +🔴' : '') + (d.mediations.find((t) => t.round === i + 1) ? ' +⚖' : '')))
  L('verdict (tesis):', d.verdict ? String(d.verdict).slice(0, 120) + '…' : '(aún no)')
  L('verdict_detail:', d.verdict_detail ? String(d.verdict_detail).length + ' car.' : '(aún no)')
  L('audit:', d.verdict_audit ? 'robustez ' + d.verdict_audit.robustness : '(aún no)')
  L('ratification:', d.ratification ? d.ratification.votes.map((v) => v.name + (v.output.ratifies ? '✓' : '✗')).join(' ') : '(no)')
  process.exit(0)
}

// ---------- modo --dump: escribe el JSON reconstruido y sale (para tests) ----------
const DUMP = flag('--dump', null)
if (typeof DUMP === 'string') { writeFileSync(DUMP, JSON.stringify(snapshot()), 'utf8'); console.log('dump →', DUMP); process.exit(0) }

// ---------- servidor + SSE ----------
function liveHtml() {
  let h = readFileSync(join(here, 'conclave.viewer.html'), 'utf8')
  if (h.charCodeAt(0) === 0xfeff) h = h.slice(1)
  h = h.replace('const DATA = "__CONCLAVE_DATA__";', 'const DATA = null;')
  h = h.replace('function wireKeys() {', 'function wireKeys() { if (window.__wired) return; window.__wired = true;')
  const boot = `      function __badge(){ let b=document.getElementById("live-badge"); if(!b){ b=document.createElement("div"); b.id="live-badge"; b.style.cssText="position:fixed;top:10px;right:12px;z-index:80;font-family:var(--mono);font-size:11px;letter-spacing:1px;color:#8fce86;background:rgba(8,6,3,.7);border:1px solid #4a3c25;border-radius:999px;padding:4px 11px"; document.body.appendChild(b);} return b; }
      function __liveRender(d){ try { const y=window.scrollY; window.__rm=d.realModel||window.__rm||""; app.innerHTML=""; window.__wired=false; render(d); window.scrollTo(0,y); const p=d._live&&d._live.pending||0; __badge().innerHTML=(p? "● EN VIVO · "+p+" pensando…" : (d._live&&d._live.waiting? "● esperando cónclave…" : "● EN VIVO")); } catch(err){ console.error(err); } }
      fetch("/data").then(r=>r.json()).then(__liveRender).catch(()=>{});
      const __es=new EventSource("/events"); __es.onmessage=(ev)=>{ try{ __liveRender(JSON.parse(ev.data)); }catch(e){} };`
  h = h.replace(/\n {6}if \(typeof DATA === "string"\) \{[\s\S]*?\n {6}\}\n/, '\n' + boot + '\n')
  return h
}
const HTML = liveHtml()
let lastJson = ''
const clients = new Set()
function tick() {
  let json; try { json = JSON.stringify(snapshot()) } catch { return }
  if (json === lastJson) return
  lastJson = json
  for (const c of clients) { try { c.write('data: ' + json + '\n\n') } catch {} }
}
const server = createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); return }
  if (req.url === '/data') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(lastJson || JSON.stringify(snapshot())); return }
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write('retry: 2000\n\n'); if (lastJson) res.write('data: ' + lastJson + '\n\n')
    clients.add(res); req.on('close', () => clients.delete(res)); return
  }
  res.writeHead(404); res.end('not found')
})
server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/'
  console.log('🕯️  conclave-live en ' + url + '  (journal: ' + (findJournal() || 'esperando…') + ')')
  lastJson = JSON.stringify(snapshot())
  setInterval(tick, 1500)
  if (OPEN) { const p = process.platform; const [c, a] = p === 'win32' ? ['cmd', ['/c', 'start', '', url]] : p === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]; try { spawn(c, a, { detached: true, stdio: 'ignore' }).unref() } catch {} }
})
