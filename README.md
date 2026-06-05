# 🕯️ conclave

> Un **cónclave** para Claude Code: un debate multi-agente hasta consenso que decide dilemas difíciles con una respuesta más robusta que la de un solo paso.
> *A multi-agent, same-model, identities-disguised debate-to-consensus skill for Claude Code.*

`conclave` crea **x debaters + 1 equipo rojo + 1 mediador**, todos sobre el **mismo modelo** de tu sesión — pero a cada debater se le hace **creer que sus pares son modelos frontera de otros laboratorios**. Ese engaño **des-sesga** el debate: evita el *herding* de «somos el mismo modelo, ya pensamos igual» y trata el acuerdo ajeno como corroboración independiente. Debaten hasta consenso (o disienten con honestidad), y opcionalmente lo ves todo en un **visualizador HTML** de tribunal a luz de vela.

---

## ¿Por qué un engaño?

Como todos los agentes son el mismo modelo, la sola creencia genera divergencia débil. Por eso cada debater razona además en un **estilo cognitivo** fijo (formalista / lateral / empirista / escéptico adversarial / sintetizador). El resultado es un debate con divergencia genuina y convergencia honesta.

## Características

- **Engaño + estilos cognitivos** — divergencia real entre agentes idénticos.
- **Equipo rojo** que ataca la postura líder cada ronda para frenar el consenso prematuro.
- **Steelman** obligatorio antes de refutar y **estatus probatorio** por punto (hecho / inferencia / especulación).
- **Fundamentación con fuentes** (cuando hay búsqueda web disponible; el indicador «con fuentes» es honesto).
- **Ratificación** final por unanimidad y **auditoría del veredicto** (segunda opinión adversarial: ¿se apoya en lo no verificado?, ¿queda una objeción viva?, ¿hay herding?).
- **Telemetría del proceso** (cambios de postura, revisión-por-argumento) y **salida honesta** (nunca fuerza un acuerdo falso).
- **Visualizador HTML** autocontenido y offline (`--ui`): rail del consejo, línea de tiempo, paneles de equipo rojo / mediador / auditoría, veredicto con sello de lacre, replay, desvelado de identidades, filtro por evidencia, copiar veredicto y ayuda.
- **Bilingüe** (es/en, autodetectado) y multiplataforma.

## Requisitos

- **Claude Code** con la herramienta **`Workflow`**.
- **Node.js** instalado (la skill ejecuta `node` para el visualizador).

## Instalación (como plugin)

```text
/plugin marketplace add dyubero/conclave
/plugin install conclave@conclave-marketplace
```

> Sustituye `dyubero/conclave` por tu repositorio de GitHub. La primera línea registra este repo como *marketplace*; la segunda instala el plugin.

Para un **equipo/proyecto**, en `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "conclave-marketplace": { "source": { "source": "github", "repo": "dyubero/conclave" } }
  },
  "enabledPlugins": { "conclave@conclave-marketplace": true }
}
```

## Uso

```text
/conclave ¿Monorepo o multirepo para un equipo de 5?
/conclave <pregunta> --ui                 # abre el visualizador al terminar
/conclave <pregunta> --agents 4 --rounds 5 --ui
```

También se activa en **lenguaje natural** al invocar el concepto: *«hagamos un cónclave sobre…»*, *«monta un debate entre modelos para decidir…»*. **No** salta ante una pregunta difícil cualquiera — solo cuando se nombra la idea (es caro: ~`agents × rounds` agentes).

### Flags

| Flag | Def | Efecto |
| --- | --- | --- |
| `--agents N` | 3 | nº de debaters (2-5) |
| `--rounds N` | 5 | tope máximo de rondas |
| `--min-rounds N` | 3 | mínimo antes de poder cerrar por consenso |
| `--purist` | off | sin estilos cognitivos (solo el engaño — es el experimento) |
| `--save [ruta]` | off | guarda el transcript completo en Markdown |
| `--ui` | off | abre el visualizador HTML del debate |
| `--lang xx` | auto | fuerza el idioma (por defecto autodetecta) |

## Cómo funciona

Cada ronda: `parallel(debaters) → equipo rojo → mediador`. El mediador distingue consenso **genuino** del de fachada y nunca cierra antes de `min-rounds`. Al declararse consenso, una ronda de **ratificación** lo confirma u objeta; después, un **auditor** independiente estresa el veredicto. Los `agent()` son *one-shot*; el script carga el transcript entre rondas, renderizado **por-agente** para que el engaño sea simétrico (cada uno se cree el único de su modelo).

## Estructura del repo

```text
.claude-plugin/   plugin.json · marketplace.json
skills/conclave/  SKILL.md · conclave.workflow.mjs · conclave-render.mjs · conclave.viewer.html
2026-06-04-conclave-design.md   spec vivo (§1-16)
2026-06-04-conclave-plan.md     plan de implementación (histórico, v1)
```

El **spec completo** está en [`2026-06-04-conclave-design.md`](./2026-06-04-conclave-design.md).

## Licencia

MIT — ver [LICENSE](./LICENSE).
