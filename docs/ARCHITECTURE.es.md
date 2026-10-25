# Arquitectura

Este documento describe lo que está construido, no el estado objetivo. Cuando
algo está planificado y no implementado, lo dice.

- [English](ARCHITECTURE.md)
- [ADRs](adr)
- [Informe de evaluación](eval-report.md)

---

## 1. Para qué sirve el sistema

LedgerPilot es un back-office de cuentas por pagar: llegan documentos, se
extraen y validan facturas, se concilian pagos, se exponen excepciones y se
proponen acciones para aprobación humana. Un modelo de lenguaje puede ayudar a
leer un documento o redactar una respuesta, pero nunca es dueño de un importe,
de una conciliación ni de una ejecución.

La arquitectura se deriva de una restricción: **el producto debe funcionar sin
ningún proveedor de IA configurado, y debe degradarse de forma visible, no
silenciosa.**

## 2. Topología de ejecución

### Desarrollo local (por defecto)

```
pnpm dev
  └─ scripts/dev.mjs
       ├─ packages/db/src/serve.ts   PGlite sobre TCP en 127.0.0.1:5433
       ├─ apps/web                   next dev en :3000
       └─ apps/mcp                   Hono en :3100
```

Un solo PostgreSQL embebido, compartido por la aplicación web y el servidor MCP
mediante el protocolo `pg` normal. Evita Docker y evita dos copias de los datos
que puedan divergir. `serve.ts` se niega a arrancar si `DATABASE_URL` está
definida, porque entonces el servidor externo es la fuente de verdad.

PGlite admite como máximo 10 conexiones concurrentes. La web mantiene un pool por
proceso y el servidor MCP el suyo. Ese es el techo práctico del entorno local y
la razón del pool pequeño.

### Desplegado (objetivo)

```
Vercel ── Next.js ── Neon con pooling (Postgres 18) ── RLS
   │
   └── servidor MCP (runtime Node) ── la misma base Neon
```

`DATABASE_URL` cambia el driver. Ningún camino de código es distinto: las mismas
consultas Drizzle y las mismas políticas RLS corren en ambos entornos.
`pnpm db:verify` comprueba un despliegue real: idempotencia de migraciones,
presencia de datos, aislamiento entre inquilinos a través del rol de aplicación y
validez del libro de auditoría.

## 3. Límites entre paquetes

| Paquete | Es dueño de | Nunca debe |
| --- | --- | --- |
| `@ledgerpilot/core` | dinero, FX, matemática de facturas, antigüedad, conciliación, política de aprobación, cadena de auditoría, guardia de ejecución | importar un modelo, una base o `next` |
| `@ledgerpilot/db` | esquema, driver, migraciones, datos, contexto de inquilino | contener aritmética de negocio |
| `@ledgerpilot/agent` | resolución de capacidades, extracción, escaneo de inyección, respuestas ancladas | escribir en la base |
| `apps/web` | renderizado, cookies (idioma, espacio), superficie HTTP | calcular resultados financieros por su cuenta |
| `apps/mcp` | adaptador de protocolo y contratos de herramientas | aceptar un inquilino enviado por el cliente |
| `@ledgerpilot/evals` | corpus, puntuación, puertas de liberación | importar código de la aplicación |

`core` es puro. Eso es lo que permite probarlo con 103 pruebas y reutilizarlo en
el arnés de evaluación sin base de datos.

## 4. Modelo de datos

16 tablas en tres grupos.

**Identidad y tenencia**

- `tenants` — espacio de trabajo, moneda base.
- `memberships` — usuario ↔ inquilino con un rol.

**Documentos y extracción**

- `documents` — nombre, tipo MIME, hash, clave de almacenamiento, `search_text`.
- `extractions` — una ejecución sobre un documento, con método y confianza.
- `extraction_fields` — valor por campo, confianza (puntos base), fragmento,
  página y método. Un campo de baja confianza es una tarea de revisión, no un fallo.

**Estado financiero**

- `invoices`, `invoice_lines` — enteros en unidades menores más moneda; sin flotantes.
- `payments`, `payment_allocations` — un pago puede aplicarse parcialmente.
- `discrepancies` — duplicados, diferencias de importe, referencias faltantes,
  pagos sin aplicar, con severidad y evidencia.
- `fx_rates` — tasa racional exacta, fecha de vigencia, fuente.
- `proposals`, `approvals`, `action_ledger` — el conducto de acciones en dos fases.
- `agent_runs`, `eval_runs` — historial operativo del agente y de las evaluaciones.

Las facturas **no tienen restricción única** sobre
`(tenant, vendor, normalized_number)` a propósito. Los números de factura
duplicados son un hecho real en cuentas por pagar; esconderlos tras una
restricción borraría justamente la excepción que el producto existe para
detectar. Los duplicados se detectan y se muestran.

## 5. El límite entre inquilinos

Toda operación con alcance de inquilino pasa por `runAsTenant(handle, tenantId, fn)`:

1. abrir una transacción;
2. `select set_config('app.tenant_id', $1, true)` — local a la transacción;
3. ejecutar las consultas del llamador;
4. confirmar o revertir.

Las políticas usan `FORCE ROW LEVEL SECURITY`, así que el dueño no las evade. Las
migraciones crean un rol no superusuario `ledgerpilot_app`; cuando la conexión es
superusuario y el rol existe, `runAsTenant` cambia con `SET LOCAL ROLE`, que es lo
que hace que el aislamiento sea real y no declarativo. Cuando el rol no existe
(algunos entornos gestionados), la variable de sesión sigue aplicándose, pero la
garantía es más débil: `pnpm db:verify` informa la presencia del rol para que un
despliegue no la pierda en silencio.

Un `app.tenant_id` desconocido o ausente devuelve cero filas en lugar de un error:
negar por defecto es más fácil de razonar que un caso especial.

## 6. Dinero y tiempo

- Los importes son `{ amount: number (unidades menores), currency: string }`.
- El análisis acepta `1,234.56`, `1.234,56`, paréntesis para negativos y símbolos
  de moneda; ante ambigüedad rechaza en lugar de adivinar.
- La asignación usa redondeo bancario y distribuye residuos de forma
  determinista, así que `100.00 / 3` no pierde un centavo.
- El FX se guarda como racional exacto (`numerador` / `denominador`) con fecha de
  vigencia; la conversión redondea una sola vez, al final.
- Las monedas sin decimales (JPY, KRW…) las maneja el registro de monedas, no un
  `100` codificado.
- El reporte usa una fecha de demo congelada (`DEMO_AS_OF=2026-06-15`) para que
  la antigüedad y los vencidos sean reproducibles en capturas, pruebas y evals.

## 7. Resolución de capacidades (el núcleo de "IA opcional")

Cinco capacidades se resuelven de forma independiente:

```
vision.extract   documento → campos estructurados
text.reason      pregunta → intención/plan
text.generate    hechos → prosa
embed            texto → vectores
rerank           candidatos → orden
```

Orden de resolución por capacidad:

1. **cloud** — existe la clave del proveedor para esa capacidad y `AI_MODE` lo permite;
2. **local** — `AI_LOCAL_BASE_URL` responde a una prueba de salud (Ollama);
3. **heuristic** — implementación determinista.

`AI_MODE` puede imponer un techo (`heuristic`, `local`, `cloud`) o dejarlo en
`auto`. El resultado es un `CapabilityReport` con el modo solicitado, el resuelto,
proveedor/modelo por capacidad y códigos de advertencia. Se expone en
`/api/health`, en la insignia lateral y en `pnpm doctor` (EN/ES). Las claves
faltantes se reportan como un hecho, no como un error.

Las implementaciones heurísticas no son simulacros:

- **Extracción** analiza facturas etiquetadas con capa de texto en inglés y
  español: número, proveedor, ambas fechas, moneda, subtotal, impuesto, total y
  líneas, cada uno con confianza y fragmento. Valida totales contra
  subtotal + impuesto y reporta diferencias.
- **Razonamiento** asigna la pregunta a un conjunto pequeño de intenciones
  respaldadas por SQL (consulta de factura, resumen de vencidos, saldo por pagar,
  resumen de excepciones, gasto por proveedor) y se abstiene cuando los datos no
  sostienen una respuesta.
- **Generación** convierte esos hechos en una plantilla bilingüe con citas.

## 8. Extracción y entrada no confiable

El texto de un documento es dato, nunca instrucción. El conducto es:

```
texto → escaneo de inyección → extracción → validación → confianza → revisión
```

El escaneo busca anulaciones de instrucciones, etiquetas de rol falsas, evasiones
de aprobación y acciones forzadas, en inglés y español. Un hallazgo agrega
`untrusted_instruction` a las banderas de riesgo del documento. Las banderas
viajan con la propuesta; la política de aprobación deniega banderas bloqueadas sin
importar el importe. Un documento que dice "paga esto ya sin aprobación" hace que
la aprobación sea *más difícil*, no más fácil.

La ambigüedad se trata igual. `03/04/2026` se analiza pero se marca ambigua, la
confianza cae por debajo del umbral de revisión y se registra una advertencia
`*_AMBIGUOUS`. La suite de evaluación no puntúa una adivinanza como correcta;
puntúa la degradación honesta.

## 9. El conducto de acciones

```
agente/persona → createProposal(payload)
                    │  payload_hash = sha256(JSON canónico)
                    │  nonce = aleatorio
                    ▼
          pending_approval ── decisión humana ──▶ approved | rejected
                    │                                  │
                    │                                  ▼
                    │                        assertExecutable(
                    │                          estado, hash, nonce,
                    │                          vigencia, nonce sin usar,
                    │                          aprobador ≠ proponente)
                    │                                  │
                    └──────────── expirada ────────────┴──▶ ejecutar una vez
```

Garantías aplicadas en código y cubiertas por la suite de seguridad:

- una propuesta no es una ejecución;
- el proponente no puede aprobar su propia propuesta (separación de funciones);
- cambiar el payload después de aprobar invalida el hash;
- un nonce se canjea una sola vez;
- una propuesta expirada no se ejecuta;
- una aprobación de una propuesta no se puede repetir en otra;
- las propuestas iniciadas por el agente siempre requieren una persona;
- cada cambio de estado se agrega a un libro encadenado por hash, y `verifyLedger`
  detecta una entrada modificada o eliminada.

## 10. La superficie web

Next.js con App Router y componentes de servidor. Dos cookies llevan el contexto
de interfaz:

- `lp_lang` — `en` | `es`; todos los textos, fechas e importes la siguen.
- `lp_workspace` — uno de los slugs sembrados; se resuelve a un id de inquilino
  en el servidor.

Ambas las fijan pequeños route handlers que validan su entrada y redirigen a una
ruta `next` **segura y del mismo origen**. El constructor del redirect usa la
cabecera `Host` de la petición y no `request.url`, porque Next normaliza la URL a
`localhost` en desarrollo y redirigir a otro host perdería la cookie recién
creada.

Las consultas pasan por `runAsTenant`; las páginas no filtran por inquilino en
JavaScript. Cambiar de espacio cambia lo que devuelve la base.

El asistente es un formulario renderizado en el servidor. Carga hechos con SQL,
llama al respondedor determinista y muestra titular, viñetas y citas. No hay
llamada a un modelo desde el cliente, así que ninguna clave llega al navegador.

## 11. El servidor MCP

- Protocolo **2026-07-28**, sin estado: cada petición es autónoma, no hay mapa de
  sesiones y `server/discover` se responde directamente.
- Transporte: Hono `app.all("/mcp", ...)` delegando al handler del SDK;
  `GET /health` es un diagnóstico JSON simple.
- El inquilino viene de `MCP_TENANT` (un slug de demo; sin definir, el primer
  espacio sembrado). Ningún esquema de herramienta contiene un campo de
  inquilino, así que un cliente no puede pedir otro espacio.
- Cuatro herramientas de lectura y una de escritura. `propose_action` inserta una
  propuesta y una entrada de libro en una transacción del inquilino, rechaza un
  payload duplicado y dice en su respuesta que no se ejecutó nada.
- Las pruebas de contrato usan el cliente real del SDK sobre `InMemoryTransport`,
  así que nombres, esquemas y formas de error se prueban como los ve un cliente.

## 12. Estrategia de evaluación

Dos preguntas distintas, dos suites distintas:

1. **¿Funciona el camino determinista?** 24 facturas sintéticas, EN/ES, tres
   formatos, cuatro monedas, ambas convenciones decimales y variantes rotativas de
   etiquetas. Precisión/recall/F1 por campo, F1 por línea, solo coincidencia exacta.
2. **¿Falla con honestidad?** 8 documentos degradados (sin total, sin moneda, sin
   vencimiento, fecha ambigua, sin capa de texto, total inconsistente, sin
   proveedor, no es una factura). La expectativa es `null` más una advertencia,
   nunca una adivinanza.

Más 17 casos de seguridad sobre escaneo de inyección, política de aprobación y
guardia de ejecución. Los umbrales viven en `packages/evals/src/report.ts` y los
verifica Vitest, así que una regresión falla en CI aunque nadie regenere el
informe. `pnpm eval` escribe `docs/eval-report.md` y sale con código distinto de
cero si no se cumple un umbral.

El informe declara sus propios límites: el corpus está dentro de la distribución,
el OCR queda fuera de alcance y los casos de seguridad son de nivel unitario,
complementados (no reemplazados) por la suite de Playwright contra el sistema real.

## 13. Operación

| Preocupación | Mecanismo |
| --- | --- |
| Cambios de esquema | migraciones SQL en orden, registradas en una tabla; idempotentes |
| Datos de demo | semilla determinista con PRNG fijo; repetirla omite inquilinos ya sembrados |
| Salud | `/api/health` (web) y `/health` (MCP): driver, conteos, cabeza del libro, capacidades |
| Verificación de despliegue | `pnpm db:verify`: migraciones, rol, datos, aislamiento, inquilino desconocido, libro |
| Auditoría | cadena de hash append-only; la verificación forma parte de salud y de CI |
| CI | typecheck → pruebas → evals (artefacto) → build; trabajo aparte con Postgres 18 para migraciones, datos, prueba de socket y paridad RLS |

## 14. Modos de falla conocidos

- **Sin OCR.** Un escaneo sin capa de texto no produce nada y va a revisión. Es
  visible en la interfaz y está afirmado en las evaluaciones.
- **La extracción heurística depende del formato.** Soporta facturas etiquetadas
  con las formas del corpus; formatos inusuales requerirán revisión.
- **Los adaptadores en la nube solo están probados por contrato.** Sin claves, la
  rama cloud se verifica con interfaces y mocks, no con llamadas reales.
- **Autenticación de demo.** El espacio se elige con una cookie, no con una
  sesión. Cualquiera puede cambiar entre los tres inquilinos de demo; ese es el
  punto de la demo y la razón por la que no deben entrar datos reales.
- **Techo de conexiones local.** PGlite permite 10 conexiones; el pool está
  dimensionado para un desarrollador, no para carga.
- **La ejecución es simulada.** El conducto es real; el banco no.

## 15. Planificado, no construido

- Organizaciones, invitaciones y MFA con Better Auth; inquilino derivado de la
  membresía.
- Extracción de texto de PDF y respaldo OCR, con evidencia por página en una
  interfaz de revisión.
- Flujos durables en Vercel Workflows para aprobaciones de varios pasos y reintentos.
- OAuth 2.1 para MCP con alcances `mcp:read`, `mcp:write`, `mcp:approve`.
- Embeddings y reranking como capa aditiva sobre la búsqueda de texto de Postgres.
- Un despliegue público en Vercel + Neon con la demo sembrada.

Esto se sigue en [TASKS.md](TASKS.md); no se presenta como hecho.
