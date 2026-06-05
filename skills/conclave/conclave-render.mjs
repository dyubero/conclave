// Renderiza el visualizador del cónclave: inyecta los datos del debate en la plantilla
// HTML autocontenida y escribe un fichero abrible en el navegador (file://).
//
// Uso:  node conclave-render.mjs <data.json> <salida.html>
//   <data.json>   = el objeto devuelto por el workflow, serializado a JSON
//   <salida.html> = ruta del HTML final a generar
//
// El resultado es un único .html portable (datos + CSS + JS inline), sin dependencias.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

// Args: <data.json> [salida.html] [--open]. Las banderas (--xxx) se filtran de los posicionales.
// Si se OMITE la salida, el HTML se escribe en un fichero TEMPORAL del SO (no ensucia el proyecto).
const argv = process.argv.slice(2)
const doOpen = argv.includes('--open')
const positional = argv.filter((a) => !a.startsWith('--'))
const dataPath = positional[0]
if (!dataPath) {
  console.error('Uso: node conclave-render.mjs <data.json> [salida.html] [--open]')
  process.exit(1)
}
const outPath = positional[1] || join(tmpdir(), `conclave-${Date.now()}.html`)

const here = dirname(fileURLToPath(import.meta.url))
const template = readFileSync(join(here, 'conclave.viewer.html'), 'utf8')

let raw = readFileSync(dataPath, 'utf8')
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolera BOM (PowerShell -Encoding utf8 lo añade)
JSON.parse(raw) // valida que es JSON; lanza si está corrupto

// Escapar '<' evita que un '</script>' dentro de un string del debate rompa el HTML.
// Dentro de JSON, '<' solo aparece en valores string, así que es seguro globalmente.
const safe = raw.replace(/</g, '\\u003c')

// Reemplazo por función para que un '$' en los datos no se interprete como patrón.
const html = template.replace('"__CONCLAVE_DATA__"', () => safe)

// BOM UTF-8 al inicio: fuerza a cualquier navegador a decodificar el HTML como UTF-8
// (evita que los acentos salgan como Latin-1) por encima de su autodetección.
writeFileSync(outPath, String.fromCharCode(0xfeff) + html, 'utf8')
console.log(outPath)

// --open: abre el HTML en el navegador por defecto (multiplataforma), sin bloquear.
if (doOpen) {
  const p = process.platform
  const [cmd, cmdArgs] = p === 'win32' ? ['cmd', ['/c', 'start', '', outPath]] : p === 'darwin' ? ['open', [outPath]] : ['xdg-open', [outPath]]
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    console.error('No se pudo abrir automáticamente:', e && e.message)
  }
}
