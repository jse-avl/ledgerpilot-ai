# LedgerPilot AI

[![CI](https://github.com/jse-avl/ledgerpilot-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/jse-avl/ledgerpilot-ai/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-059669.svg)](LICENSE)

**Cuentas por pagar, bajo control.** Un agente de back-office financiero con IA
opcional: el núcleo determinista hace la aritmética y las aprobaciones, los
modelos son una capa adicional, y el agente puede proponer movimientos de dinero
pero nunca ejecutarlos.

[English](README.md) · [Arquitectura](docs/ARCHITECTURE.es.md) · [Informe de evaluación](docs/eval-report.md) · [Tablero de tareas](docs/TASKS.md)

---

## Ejecutarlo en un minuto, sin claves y sin Docker

```bash
pnpm install
pnpm dev
```

- Aplicación web → <http://localhost:3000>
- Servidor MCP → <http://localhost:3100/mcp> (`/health` para un JSON simple)
- Salud → <http://localhost:3000/api/health>

No hay nada que registrar. Con un `.env` vacío la aplicación levanta un
PostgreSQL embebido (PGlite) en `127.0.0.1:5433`, aplica migraciones, siembra
tres espacios de demostración y ejecuta todo en **modo heurístico**. Sin clave de
API, sin cuenta en la nube, sin contenedores.

Desde un clon nuevo, `pnpm setup` hace esa preparación de forma explícita
(archivo de entorno, instalación, migraciones, datos y reporte de capacidades) y
se puede repetir sin efectos secundarios.

> Los datos son sintéticos y la fecha de reporte está fijada en **2026-06-15**
> para que la antigüedad y los vencimientos sean reproducibles. La fecha se
> muestra en la interfaz.

## Por qué no es otra demo de "facturación con IA"

Tres afirmaciones, cada una con código y una prueba detrás:

| Afirmación | Qué significa aquí |
| --- | --- |
| **La IA es opcional por capacidad** | `vision.extract`, `text.reason`, `text.generate`, `embed` y `rerank` se resuelven de forma independiente: `cloud` → `local` (Ollama) → `heuristic`. Si falta una clave se degrada una capacidad, nunca el producto. La interfaz indica qué modo está activo. |
| **El dinero nunca se convierte en flotante** | Los importes son enteros en unidades menores más una moneda. El tipo de cambio usa tasas racionales exactas. La asignación y el redondeo se prueban con casos tipo propiedad. |
| **El agente propone; una persona paga** | La única herramienta de escritura crea una propuesta con hash del payload y un nonce. Ejecutar exige una aprobación separada, hash coincidente, nonce sin usar y propuesta vigente. Las propuestas iniciadas por el agente siempre requieren aprobación humana. |

Lo interesante de un agente en finanzas no es el prompt. Es qué pasa cuando el
modelo se equivoca, no está disponible o el documento que lee intenta manipularlo.

## Qué muestra la demo

Tres inquilinos, aislados por Row Level Security de PostgreSQL:

| Espacio | Proveedores (muestra) | Historia |
| --- | --- | --- |
| Northwind Trading Co. | Apex Industrial Supply | Un libro de cuentas por pagar limpio, en USD |
| Café Americana | Panama Coffee Roasters | El mismo sistema, interfaz en español, proveedores latinoamericanos |
| Pacific Logistics S.A. | Balboa Freight | Pagos concentrados en flete y exposición cambiaria |

Cambia de espacio desde la barra lateral: las filas cambian porque la base de
datos se consulta como otro inquilino, no porque la interfaz filtre un arreglo.

Vale la pena abrir:

- **Resumen** — saldo por pagar, vencidos, antigüedad por moneda, excepciones
  abiertas y la cabeza del libro de auditoría con su verificación.
- **Facturas** — búsqueda por número, proveedor y texto del documento; al abrir
  una factura se ven líneas, pagos aplicados y el documento de origen.
- **Excepciones** — duplicados, diferencias de importe, referencias faltantes y
  pagos sin aplicar, cada una con la evidencia que la produjo.
- **Propuestas** — asignaciones propuestas por el agente, visiblemente *no
  ejecutadas*, con hash del payload, nonce y roles necesarios para aprobar.
- **Asistente** — respuestas calculadas con SQL sobre el espacio actual, con
  citas. Pregunta "¿Qué facturas están vencidas?" en cualquiera de los dos idiomas.
- **Selector de idioma** — EN/ES por cookie, renderizado en el servidor. Sin
  estado en el cliente.

## Evidencia, no adjetivos

`pnpm eval` corre sin conexión y escribe [`docs/eval-report.md`](docs/eval-report.md):

| Métrica | Resultado | Umbral |
| --- | --- | --- |
| F1 por campo (24 facturas × 8 campos, EN/ES, 4 monedas) | 100,0% | ≥ 90% |
| F1 por línea de detalle | 100,0% | ≥ 90% |
| Documentos degradados tratados con honestidad (8 casos) | 8/8 | 100% |
| Casos de seguridad: inyección, aprobación, ejecución (17) | 17/17 | 100% |

El corpus soportado es sintético y deliberadamente dentro de la distribución: es
un arnés de regresión para los formatos que el extractor dice soportar, no una
afirmación sobre escaneos arbitrarios. El conjunto degradado mide el contrato
opuesto: cuando un documento es ilegible o ambiguo, el sistema devuelve `null`,
baja la confianza y emite una advertencia en lugar de inventar un número. El
informe lo dice con claridad, incluido lo que **no** mide.

Pruebas: **195 pruebas de paquetes** (dinero, FX, antigüedad, conciliación,
política de aprobación, libro de auditoría, RLS, migraciones, contrato MCP,
extracción y evaluaciones) más **7 pruebas de Playwright** contra el sistema real.

## Arquitectura en una imagen

```
┌────────────┐     ┌──────────────────────────┐     ┌────────────────────┐
│  Navegador │────▶│ apps/web (Next.js 16)    │────▶│ packages/core      │
│  EN / ES   │     │ RSC · idioma por cookie  │     │ dinero · FX · aging│
└────────────┘     │ espacio por cookie       │     │ política · ledger  │
                   └───────────┬──────────────┘     └────────────────────┘
                               │ Drizzle + RLS                 ▲
                   ┌───────────▼──────────────┐               │
                   │ packages/db              │     ┌─────────┴──────────┐
                   │ PGlite ── o ── Postgres  │◀────│ packages/agent     │
                   │ 16 tablas · migraciones  │     │ capacidades        │
                   └───────────▲──────────────┘     │ extracción         │
                               │                    │ respondedor        │
                   ┌───────────┴──────────────┐     └────────────────────┘
                   │ apps/mcp (Hono :3100)    │
                   │ MCP 2026-07-28, sin      │
                   │ estado · 4 lectura + 1   │
                   │ propuesta                │
                   └──────────────────────────┘
```

Límites importantes:

- **`core` nunca importa un modelo ni una base de datos.** Son funciones puras
  sobre dinero y políticas, y ahí vive toda la verdad financiera.
- **`db` es dueño del esquema y del límite entre inquilinos.** Cada consulta
  corre dentro de `runAsTenant`, que fija `app.tenant_id`; las políticas RLS usan
  `FORCE ROW LEVEL SECURITY`, así que incluso el dueño de la tabla queda filtrado
  cuando el rol no es superusuario.
- **`agent` no puede escribir.** Produce extracciones, banderas y texto anclado
  a datos reales.
- **`mcp` y `web` son adaptadores.** Ninguno contiene aritmética de negocio.

Más detalle, incluidos modos de falla y topología de despliegue:
[`docs/ARCHITECTURE.es.md`](docs/ARCHITECTURE.es.md).

## IA, cuando tengas claves

Toda variable de IA es opcional. La resolución es por capacidad y se muestra en
`/api/health`, en `pnpm doctor` y en la insignia de la interfaz.

```dotenv
# Ninguna es obligatoria.
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_LOCAL_BASE_URL=http://localhost:11434/v1   # Ollama, si está corriendo
AI_MODE=auto                               # auto | mock | local | cloud
```

Sin clave y sin Ollama, `AI_MODE=auto` resuelve a `heuristic`. El asistente
sigue respondiendo: traduce la pregunta a una intención respaldada por SQL y
redacta una respuesta determinista con citas. Se abstiene cuando el espacio no
tiene evidencia para la pregunta, en lugar de adivinar.

## El servidor MCP

`apps/mcp` habla el protocolo **2026-07-28** sin estado sobre HTTP en `/mcp`.

| Herramienta | Tipo | Garantía |
| --- | --- | --- |
| `health_check` | lectura | driver, conteos, cabeza del libro, modos de capacidad reales |
| `search_documents` | lectura | búsqueda de texto completo limitada al espacio resuelto |
| `get_invoice` | lectura | factura, líneas, pagos y documento de origen |
| `list_discrepancies` | lectura | excepciones abiertas con su evidencia |
| `propose_action` | escritura | solo propuesta + entrada encadenada de auditoría; nunca ejecuta |

El inquilino lo **resuelve el servidor** desde `MCP_TENANT`. Ninguna herramienta
acepta un id de inquilino y ningún cliente puede ampliar su propio alcance.
`propose_action` siempre marca la propuesta como `agent_initiated`, lo que fuerza
aprobación humana sin importar el importe, y rechaza una propuesta duplicada del
mismo payload.

```bash
curl -s http://127.0.0.1:3100/health | jq
```

Conecta cualquier cliente MCP a `http://127.0.0.1:3100/mcp`; `MCP_TENANT` acepta
un slug de demo (`northwind`, `cafe-americana`, `pacific-logistics`). Sin
definirlo, el servidor sirve el primer espacio sembrado.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | base de datos + web + MCP en un solo árbol de procesos |
| `pnpm setup` | preparación desde un clon nuevo, repetible |
| `pnpm test` | pruebas de paquetes (Vitest) |
| `pnpm typecheck` | TypeScript en todo el monorepo |
| `pnpm eval` | evaluación offline; falla si no se alcanza un umbral |
| `pnpm build` | compilación de producción |
| `pnpm doctor` | reporte de capacidades, EN/ES |
| `pnpm db:migrate` / `db:seed` / `db:reset` | ciclo de vida de la base |
| `pnpm db:verify` | verificación de despliegue: migraciones, datos, RLS, libro |
| `pnpm --filter @ledgerpilot/web e2e` | Playwright contra el sistema real |

## Estructura del repositorio

```
apps/
  web/            aplicación Next.js 16 (RSC, Tailwind 4, cookies)
  mcp/            servidor MCP sin estado (Hono)
packages/
  core/           dinero, FX, facturas, antigüedad, conciliación, política, libro
  db/             esquema Drizzle, doble driver, migraciones, datos, verificación
  agent/          resolución de capacidades, extracción, inyección, respondedor
  evals/          corpus bilingüe sintético, arnés F1, casos de seguridad
docs/             arquitectura, ADRs, informe de evaluación, tablero
scripts/          orquestación de desarrollo y preparación
```

## Decisiones

Los registros de decisiones de arquitectura están en [`docs/adr/`](docs/adr):

- [0001 — Dinero en unidades menores enteras](docs/adr/0001-money-as-minor-units.md)
- [0002 — IA opcional por capacidad](docs/adr/0002-ai-optional-by-capability.md)
- [0003 — PGlite local, Postgres/Neon en producción](docs/adr/0003-pglite-local-neon-production.md)
- [0004 — MCP 2026-07-28, sin estado, inquilino resuelto en el servidor](docs/adr/0004-mcp-stateless-tenant.md)
- [0005 — Propuestas en dos fases y aprobación humana](docs/adr/0005-two-phase-proposals.md)
- [0006 — Evaluaciones como puerta de liberación](docs/adr/0006-evals-as-release-gate.md)
- [0007 — Ejecución durable con Vercel Workflows (propuesta)](docs/adr/0007-vercel-workflows.md)

## Limitaciones, dichas a propósito

- **Esta versión no tiene OCR.** Los documentos sin capa de texto se rechazan y
  van a revisión; el OCR es el siguiente paso de extracción, no una promesa oculta.
- **Los adaptadores en la nube están probados por contrato, no con claves.** No
  hubo claves disponibles durante la construcción, así que el modo nube se
  ejercita mediante interfaces y mocks. El camino determinista es el que se cubre
  de extremo a extremo.
- **La extracción está ajustada a facturas etiquetadas con capa de texto** en
  inglés y español. Los escaneos arbitrarios necesitarán OCR y un corpus mayor.
- **La autenticación es de demo.** El espacio se elige con una cookie entre tres
  inquilinos sembrados; las organizaciones de Better Auth y las sesiones reales
  son el siguiente hito.
- **La ejecución es simulada.** Las propuestas se guardan y se auditan; ninguna
  integración bancaria o ERP mueve dinero. Es deliberado para una demo pública.

## Trabajo relacionado

Este proyecto sigue a [`financial-automation`](https://github.com/jse-avl/financial-automation)
(automatización de conciliación y reportes) y [`sap-po-automation`](https://github.com/jse-avl/sap-po-automation)
(ingesta de documentos para compras). LedgerPilot es la capa agéntica que a esos
sistemas les faltaba: la misma disciplina financiera, con límites explícitos
para los modelos.

## Licencia

MIT © 2026 jse-avl. Ver [LICENSE](LICENSE).
