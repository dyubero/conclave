# Vista en vivo: actualización incremental sin reconstruir el DOM

Fecha: 2026-06-09
Archivo afectado: `skills/conclave/conclave-live.mjs` (bloque `boot` inyectado) — sin reescribir `conclave.viewer.html`.

## Problema

La vista en vivo (`conclave-live.mjs`) ya transmite por SSE (`EventSource` sobre `/events`), así que el
navegador **nunca hace un reload real**. Pero en cada actualización el cliente ejecuta, en `__liveRender`:

```js
app.innerHTML = "";   // destruye TODO el DOM
window.__wired = false;
render(d);             // lo reconstruye entero desde cero
window.scrollTo(0, y);
```

Reconstruir el árbol completo cada ~1,5 s provoca:

- Parpadeo/salto visual que el usuario percibe como "se recarga la página".
- Se cierran las tarjetas que el usuario había desplegado (`.detail` → clase `open`).
- Se pierde el foco de un debater seleccionado (`.member.sel` / `.entry.is-focus`).
- Se re-disparan las animaciones de entrada (`.anim`) en bloques que no cambiaron.

## Objetivo

Que los cambios aparezcan **en vivo** y de forma incremental: solo se toca en el DOM aquello que cambió
(un agente que pasa de "pensando" a resuelto, una ronda nueva al final, el veredicto cuando se emite),
conservando intacto todo lo demás.

## Por qué el visor es apto

`render()` produce **unidades bien delimitadas** como hijos planos:

- Bajo `#app`: `.masthead`, `.toolbar`, `.shell`, `.verdict`.
- Bajo `.shell`: `.council` (aside) y `.thread` (main).
- Bajo `.thread`: `.sec`, y por ronda `.round-mark` (`#rm{n}`), `.round-sum`, las entradas
  `.entry.stmt.step` / `.entry.redteam.step` / `.entry.mediator.step`, y al final `.entry.ratify.step`.
- Bajo `.council`: `h2`, una `.member` por participante, `.council-live`, `.legend`.

El flujo en vivo es **siempre aditivo o reemplazo en su sitio** (nunca reordena): un placeholder
"pensando" se sustituye por la tarjeta resuelta en el mismo índice; una ronda nueva, el equipo rojo,
el mediador y la ratificación se **añaden al final**. Por eso un morph que alinea hijos **por posición**
es seguro.

## Diseño

Todo el cambio vive en el bloque `boot` que `liveHtml()` inyecta sobre el HTML del visor. El archivo
`conclave.viewer.html` se mantiene puro (sigue funcionando offline/estático igual); solo se le aplican,
en tiempo de servido, dos retoques quirúrgicos vía `String.replace`, igual que ya se hace con `DATA` y
`wireKeys`.

### Retoques al HTML servido (en `liveHtml()`)

1. `const app = document.getElementById("app");` → `let app = document.getElementById("app");`
   para poder re-apuntar `app` al contenedor scratch durante el render.
2. En la cola de `render()`:
   - `document.querySelectorAll(".step")` → `app.querySelectorAll(".step")`
   - `document.getElementById("seek")` → `app.querySelector("#seek")`

   Así, al renderizar en scratch, la animación `.anim` (con su `animationDelay` por índice) y el ajuste
   del scrubber se aplican a los nodos **scratch**, no a los vivos. Resultado: lo conservado no parpadea
   y solo lo nuevo/reemplazado entra con animación, sin trabajo extra de tracking.

### Nuevo `__liveRender(d)`

1. `const realApp = document.getElementById("app");`
2. `const scratch = document.createElement("div");` (desconectado del documento).
3. `app = scratch; render(d); app = realApp;` → el árbol nuevo se construye completo en scratch.
   (Todo es síncrono: no hay paint intermedio entre re-apuntar y restaurar.)
4. `const y = window.scrollY; morph(realApp, scratch); window.scrollTo(0, y);`
5. Re-derivar el scrubber desde el DOM **vivo**:
   `STEPS = Array.from(realApp.querySelectorAll(".step"))`, ajustar `#seek.max` y `setCursor(STEPS.length)`.
6. Re-aplicar estado de interacción sobre los nodos vivos (ver abajo) y re-vincular
   `realApp.querySelector("#copybtn").onclick = () => copyVerdict(d)` con los datos frescos.
7. Actualizar el badge (lógica actual sin cambios).

Se eliminan `app.innerHTML = ""` y `window.__wired = false`.

### `morph(real, scratch)` — recursivo, alineando hijos por posición

Recorre `real.children` y `scratch.children` por índice:

- Si no hay viejo en esa posición → **insertar** el nuevo (`appendChild`, mueve el nodo desde scratch).
- Distinto `tagName` → **reemplazar** entero.
- `on.isEqualNode(nn)` (idénticos en estructura/atributos/texto) → **conservar** el viejo tal cual
  (preserva `open`, foco, animación ya consumida y sus *handlers*).
- Es un **contenedor estructural** (`#app` raíz, `.shell`, `.thread`, `.council`) en ambos → **recursión**.
- Cualquier otra unidad que cambió → **reemplazo entero** por el nodo nuevo (con *handlers* frescos →
  evita el bug de closures que retienen un `d` viejo, p. ej. `copyVerdict`).
- Hijos viejos sobrantes al final → **eliminar**.

Se opera sobre `.children` (solo elementos); los contenedores relevantes no mezclan nodos de texto.

La identificación de "contenedor estructural" se hace por clase (`shell` / `thread` / `council`) más la
comparación `node === realApp` para la raíz.

### Re-aplicación de estado de interacción (post-morph)

Estados que viven como clases en `<body>` se preservan solos (no se morfea `<body>`): filtro de
evidencia (`ev-*`) y desvelar (`unmasked`).

Estados que viven en nodos que pueden haber sido reemplazados → re-aplicar desde los globales que ya
persisten en el script del visor:

- **Foco** (`focusIdx`): re-marcar `.member.sel` y `.entry.stmt.is-focus` correspondientes.
- **Expandir todo** (`allOpen`): re-aplicar clase `open` y texto del `.morebtn` a las entradas.

El desplegado de **una** tarjeta concreta (no "expandir todo") se conserva si esa tarjeta no cambió
(se conserva por `isEqualNode`); si su contenido cambió, se reemplaza y se colapsa — comportamiento
aceptable, porque su contenido es otro.

## Limitación conocida (aceptada)

Si el usuario está a mitad de un *replay* manual (pausado en un paso intermedio) y llega una
actualización, el cursor salta al final, igual que hoy. Mientras el cónclave está en vivo es lo natural;
el replay fino es para cuando ya concluyó, momento en que dejan de llegar actualizaciones.

## Verificación

- `node conclave-live.mjs --once` y `--dump <out.json>` deben seguir funcionando idénticos (no tocan el
  bloque `boot`; solo afecta al HTML servido).
- Comprobación manual en navegador durante un cónclave en vivo: al resolverse cada agente, solo su
  tarjeta cambia; el scroll, las tarjetas desplegadas y el foco se mantienen; no hay parpadeo global.
- Estado inicial: con `#app` vacío, el primer `__liveRender` hace `morph(vacío, scratch)` → inserta todo.
