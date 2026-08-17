# StudyX — Análisis completo: contexto interno vs. sitio oficial

**Fecha:** 14 de agosto de 2026
**Fuentes:** (A) los 9 documentos del proyecto SPACE X IA · (B) extracción literal de `https://mystudyx.com` — 40+ URLs, incluidas las 28 fichas de diplomado, la tienda completa (2 páginas), carrito, checkout, legales, registro, campus, robots.txt y la Store API pública de WooCommerce.
**Regla del documento:** todo dato de la Parte B es transcripción literal del sitio. Donde el sitio no dice nada, dice **NO EXISTE**. Ninguna inferencia se presenta como hecho; las hipótesis están marcadas como tales.

---

## 0. Resumen ejecutivo

Hay **dos StudyX** y no coinciden.

El **StudyX del contexto** es un proyecto de ingeniería maduro: un orquestador transaccional con invariantes, idempotencia en tres niveles, HMAC, outbox y un plan de 20 fases. Su bloqueo declarado desde el 28 de julio es *"no sabemos el catálogo, no sabemos el PSP, no sabemos la entidad legal"*.

El **StudyX del sitio** es un negocio que ya vende: 30 productos, moneda USD, una pasarela de pagos activa (**Authorize.Net CIM**, ni Stripe ni Mercado Pago), entidad legal estadounidense (My Study X, LLC / World Digital Group Corp, Florida) y ley aplicable de EE.UU.

**El hallazgo central:** varios de los "bloqueadores críticos" que frenan el proyecto **ya tienen respuesta pública en el sitio** y nadie la fue a buscar. Y a la inversa: el sitio tiene **contradicciones comerciales y legales que harían inviable el agente de ventas tal como está diseñado**, la más grave un curso que se publicita a **$699** y se cobra a **$1.200**.

**Los cinco hallazgos que cambian decisiones:**

| # | Hallazgo | Impacto |
|---|---|---|
| 1 | **Doble precio.** `/diplomado/barista/` publica `$699.00USD`; su botón "Comprar" lleva a `/product/barista/`, que cobra `$1,200.00`. Verificado en 3 cursos. **+71,7 %** | Si el agente cita un precio del sitio, cita el equivocado. Bloquea el catálogo determinístico (C1). |
| 2 | **El PSP ya existe: `authorize_net_cim_credit_card`.** No es Stripe ni Mercado Pago. La entidad de cobro es una LLC de Florida, con ley y tribunal de EE.UU. | Desbloquea el bloqueador A3 abierto desde el 28-jul. El JSON de Retell dice "Stripe" en 6 campos: está mal. |
| 3 | **El consentimiento capturado es para SMS y llamadas, no para WhatsApp.** Literal del sitio: *"nos das tu consentimiento para comunicarnos contigo por SMS"*. La política de privacidad dice *"We contact the people who fill out the form trough calls and SMS"*. | Un agente de WhatsApp operaría sobre un opt-in que no cubre ese canal. Riesgo regulatorio y de Meta. |
| 4 | **Los T&C desmienten el claim de certificación de la home.** Home: *"Certificación verificada"*, *"Certificamos tus logros"*. T&C: *"No somos una entidad educativa con licencia para brindar títulos"* y *"nuestros cursos/capacitaciones, no obtienen un certificado o licencia para poder ejercer dichos aprendizajes"*. | Define qué puede y qué **no** puede prometer el agente. Debe entrar en `POLITICA-COMERCIAL.md` textual. |
| 5 | **El embudo de alta está roto.** `/student-registration/` — destino de **todos** los botones "Register" del sitio — responde `Registration disabled. Please ask site admin to enable registration.` | No hay alta self-serve. El fulfillment post-pago es manual sí o sí, lo que valida el nodo Excel pero contradice "todo lo resuelve la IA". |

---

# PARTE A — Lo que ya tenemos en contexto

*(Fuente: los 9 documentos del proyecto. Esto es lo que el equipo sabe y decidió.)*

## A.1 Qué es el proyecto

Un **agente de ventas conversacional para StudyX** que cierra oportunidades por WhatsApp con seguridad transaccional, idempotencia y auditoría completa.

- **Stack:** Next.js + PostgreSQL 17 + pgvector + Botpress ADK + Supabase
- **Regla ordenadora:** *Botpress conversa, Next.js decide, Supabase recuerda, los workers ejecutan efectos.*
- **Ubicación:** `/Users/tmaneyro22/Documents/AGENTE IA/`

## A.2 Arquitectura en cuatro capas

| Capa | Tecnología | Rol | Qué NO hace |
|---|---|---|---|
| 1 · Canal | Botpress ADK + WhatsApp | Recibe, identifica, redacta dentro de límites, envía | Decidir precio, etapa comercial, pago, alta |
| 2 · Decisión | Next.js Route Handlers | Valida, decide política, persiste | — |
| 3 · Verdad | PostgreSQL 17 + pgvector (Supabase) | ACID, constraints, trazabilidad | — |
| 4 · Efectos | Workers sobre outbox | Excel, pago, voz | Romper la conversación si fallan |

**Contrato de tres pasos:** `POST /api/agent/ingest` → `POST /api/agent/turns/:id/decision` → `POST /api/agent/outbounds/:id/delivery`. Firma HMAC v1 con ventana de 5 minutos.

**Cinco máquinas de estado independientes:** comercial (`new → qualifying → qualified → proposal → won|lost|disqualified`), turno, llamada, pago y fulfillment.

## A.3 Las 8 invariantes no negociables

1. Un `(channel, external_message_id)` = máximo 1 inbound
2. Un inbound = máximo 1 outbound lógico *(v2: de origen `agent_a_turn`)*
3. Solo 1 conversación abierta por `(contact_id, channel)`
4. **Contacto bloqueado o sin consentimiento ≠ outbound comercial** ← la que más importa acá
5. Outbound solo es `sent` si el canal lo confirmó
6. Fallo de OpenAI/pgvector ≠ crea/revierte mensaje canónico
7. Todo se rastrea: `external_message_id` → `turn_id` → delivery → auditoría
8. Resúmenes/embeddings son derivados; nunca reemplazan consentimiento/precios/pagos

## A.4 Estado real

- ✅ **Fase 1** — núcleo idempotente y transaccional
- ✅ **Fase 2** — memoria segura, OpenAI fuera del path transaccional
- 🟡 **Fase 3** — contrato Botpress; evaluaciones pendientes; **bloqueada por la instalación/autenticación oficial de WhatsApp en Botpress**
- ⏸️ **Fase 4** — gate de producción

El análisis del 7-ago fue duro y correcto consigo mismo: *"no hay que crear un orquestador desde cero — hay que completarlo y ponerlo a prueba"*, y **"agente de ventas" es hoy "agente de conversación segura"**: la venta (oferta → pago → verificación) no está empezada.

## A.5 Debilidades que el propio contexto reconoce

1. `retry_pending` y `paused_error` **son estados sin dueño** — no hay consola ni job que los drene (brecha operativa nº 1)
2. **El conocimiento no existe como sistema** — el prompt prohíbe inventar precios, pero no hay corpus aprobado, versionado, con dueño
3. Divergencia arquitectónica abierta (Botpress-coordinador vs Vercel Workflow), a resolver por ADR
4. Contradicción documental sobre el handoff — resuelta el 8-ago con **D1: la voz sí transfiere en vivo; el texto no**
5. **El catálogo comercial real no existe** (decisión D3): todo corre con datos sintéticos marcados `es_dato_de_prueba: true`

## A.6 Lo que el contexto AFIRMA sobre el negocio StudyX

Esto es clave, porque es lo único "de negocio" que el proyecto tiene, y sale casi todo del JSON del agente de voz de Retell — es decir, de suposiciones, no del cliente.

**Academias declaradas (9):** gastronómica · salud y bienestar · marketing · moda y belleza · oficios · emprendedores · **diseño informático** · **negocios** · **cultural**

**Cursos nombrados en `boosted_keywords` (14):** uñas gelificadas · maquillaje profesional · **reparación de celulares** · **aires acondicionados** · **cámaras de seguridad** · paisajismo · pastelería · marketing digital · **community manager** · nutrición · fotografía · Photoshop · **Excel** · **criptomonedas**

**Condiciones comerciales que los prompts dan por ciertas:** clases grabadas · ritmo propio · **sin vencimiento** · desde celular o compu · ejercicios y exámenes · profesores que responden consultas · clases en vivo · certificado de la academia (explícitamente *no* título oficial, *no* homologación, *no* matrícula) · **pago contado o en cuotas** · moneda por defecto USD

**Bloqueadores críticos declarados abiertos:**
- **Entidad legal y país de cobro** — *"Argentina no está en la lista oficial de Stripe"* → evaluar Mercado Pago
- **Habilitación de Meta y consentimiento** — WABA, app Meta, credenciales, webhook, verificación, templates
- **Catálogo real** — cursos, precios por país, cuotas, promos y el texto exacto del certificado

## A.7 Las reglas de política comercial ya escritas (§1.8 del doc de voz)

Vale conservarlas textuales, porque el cruce con el sitio las valida casi todas:

- Nunca inventar precio, descuento, cuota, promoción, duración, contenido, certificación ni validez oficial. **Todo dato comercial sale de una herramienta.**
- Nunca prometer homologación, título oficial, matrícula profesional, salida laboral garantizada ni ingresos
- Nunca pedir datos de tarjeta, CVV, cuenta ni claves. El pago va siempre por link
- Si preguntan si es una IA, **decir que sí**
- No dar consejos médicos, legales, financieros ni migratorios
- Un "no" claro dos veces se acepta; una objeción trabajada dos veces se deja de empujar

---

# PARTE B — Lo que dice mystudyx.com

*(Todo lo que sigue es literal del sitio, extraído el 14-ago-2026.)*

## B.1 Identidad corporativa y legal

| Dato | Valor literal |
|---|---|
| Marca | `Studyx | Academia Internacional` |
| Operadora | `World Digital Group Corp (doing business as MyStudyx)` |
| Propietaria | `Property of My Study X, LLC` |
| Ubicación declarada | `Located in South Florida, United States.` |
| Domicilio en T&C | `300 bayview dr, apt 604 Sunny Isles Beach, Fl 33160` |
| Oficina administrativa | `16500 Collins Ave, Sunny Isles FL 33160` · `300 Bayview Drive, Sunny Isles FL 33160` |
| Otras sedes | `Antonia López de Bello Nro 114 - Depto 303, Recoleta, Santiago de Chile` |
| Teléfono | `+1 (866) 217-7282` (toll-free de EE.UU.) |
| Email | `info@mystudyx.com` |
| Ley aplicable | `se aplicará la legislación estadounidense y todas las disputas... serán resueltas por el tribunal estadounidense competente` |
| Edad mínima | `Para usar el sitio debe tener 18 años o ser mayor de edad en su país` |
| Redes | Facebook `Studyx-Academia-Internacional-102576545444592` · Instagram `@studyxacademia` |
| Google | **4.7** sobre **17 reseñas** |
| Desarrollo | `© Copyright 2022 by Verticedigital` → `verticedigital.com.ar` |

> **Consecuencia inmediata para el proyecto:** la entidad de cobro **no es argentina**. Es una LLC de Florida bajo ley estadounidense. El bloqueador *"Argentina no está en la lista de Stripe"* se apoyaba en una premisa que el sitio contradice.

## B.2 Catálogo real — los tres inventarios que no coinciden

El sitio tiene **tres listas de cursos distintas**, con distinta cantidad y distinta taxonomía:

| Inventario | Cantidad | URL |
|---|---|---|
| Tienda (WooCommerce) | **30 productos** | `/shop` (`Mostrando 1–24 de 30 resultados` + página 2) |
| Diplomados (CPT) | **28 fichas** | `/diplomados/` |
| Claim de la home | **`más de 50 diplomados online`** | `/` |

**En la tienda pero SIN ficha descriptiva (2):** `AutoCAD – Orientado al Diseño de Interiores` y `Estrategias para Emprender`. Son vendibles y no tienen una sola página que los explique.

**Categorías, dos taxonomías incompatibles:**

| Tienda (WooCommerce) | `/diplomados/` |
|---|---|
| Oficios (10) · Marketing (8) · **Academia Beauty** (5) · Gastronomía (4) · Salud y Bienestar (4) | Oficios · Marketing · **Moda y Belleza** · Gastronomía · Salud y Bienestar · **Emprendedores** |

`Academia Beauty` ≠ `Moda y Belleza`, y `Emprendedores` no existe en la tienda. Los conteos de categoría suman **31 sobre 30** productos.

### Los 28 diplomados con sus datos reales

| Diplomado | Clases declaradas | Temario en el sitio | Precio en `/diplomado/` |
|---|---|---|---|
| Maquillaje Profesional | 38 (5 módulos) | ✅ completo | $699.00USD |
| Entrenamiento Funcional | 36 (3 módulos) | ✅ completo | $699.00USD |
| Decoración de Interiores | 34 | ✅ 20 ítems ⚠️ | $699.00USD |
| Uñas gelificadas | 25 | ✅ ~26 ítems ⚠️ | $699.00USD |
| Masoterapia | 24 | ✅ 18 ítems ⚠️ | $699.00USD |
| Paisajismo & Jardinería | 24 | ✅ 23 ítems ⚠️ | $699.00 USD |
| Fotografía Profesional | 41 | ✅ 26 módulos ⚠️ | $699.00USD |
| Técnica/o en Estética Integral | 20 | ✅ 19 clases ⚠️ | $699.00USD |
| Introducción al Vino, la Cata y el Maridaje | 19 | ✅ 20 ítems ⚠️ | $699.00 USD |
| Nutrición y Alimentación Saludable | 16 | ✅ 16 ítems | $699.00USD |
| Asistente y Cuidador de Adultos Mayores | 14 (+7 TI +TP final) | ✅ completo | $699.00USD |
| Auxiliar de Farmacia | 12 | ❌ | contaminado (ver B.7) |
| Barista | 12 | ✅ 12 ítems | $699.00USD |
| Sushi para Principiantes | 10 | ✅ 11 ítems ⚠️ | $699.00 USD |
| Técnica/o en Depilación Definitiva | 7 | ✅ 7 clases | $699.00USD |
| Introducción a la Pastelería/Repostería | 15 | ❌ solo PDF | NO EXISTE |
| Diseño gráfico en Photoshop | 16 | ❌ solo PDF | NO EXISTE |
| Diseño gráfico con **Ilustrator** *(sic)* | 16 | ❌ solo PDF | NO EXISTE |
| Diseño gráfico en Coreldraw | 16 | ❌ solo PDF | NO EXISTE |
| Marketing Digital | 16 | ❌ | NO EXISTE |
| Real Estate | 11 | ❌ | NO EXISTE |
| Plomería | 10 | ❌ | ambiguo |
| Energía Solar Fotovoltaica | 8 | ❌ | NO EXISTE |
| **Home Maintenence** *(sic)* | 8 | ❌ | contaminado |
| Estudios Bíblicos para la Vida Diaria | 8 | ❌ solo objetivos | NO EXISTE |
| Organizador Profesional de Eventos Sociales | 8 | ❌ **página vacía** | NO EXISTE |
| Curso de Electricista | — | no verificado | no verificado |
| Publicidad en las Redes Sociales | — | no verificado | no verificado |

⚠️ = la cantidad de clases declarada no coincide con la cantidad de ítems del temario.

**Aproximadamente la mitad del catálogo (13 de 28) no tiene temario publicado en el sitio.** En esos casos el temario existe solo dentro del PDF de "Descargar programa".

## B.3 Precios — la contradicción más cara

**Verificado directamente, tres veces:**

| Curso | `/diplomado/<slug>/` | Botón "Comprar" lleva a | Precio real de cobro |
|---|---|---|---|
| Barista | **`$699.00USD`** | `/product/barista/` | **`$1,200.00`** |
| Auxiliar de Farmacia | **`$699.00USD`** | `/product/auxiliar-de-farmacia/` | **`$1,200.00`** |
| Uñas gelificadas | **`$699.00USD`** | `/product/unas-gelificadas/` | **`$1,200.00`** |

**Los 30 productos de la tienda cuestan exactamente `$1,200.00`.** Sin excepción, sin descuentos activos (`on_sale: false` en los 30), sin precios tachados. Los 15 diplomados que publican precio publican exactamente `$699.00USD`. Sin excepción.

**Diferencia: +71,7 %.** El usuario ve $699 y paga $1.200.

Datos duros de la Store API pública:
```json
"currency_code": "USD", "currency_symbol": "$", "currency_minor_unit": 2,
"payment_methods": ["authorize_net_cim_credit_card"],
"tax_lines": [], "needs_shipping": false
```

- **Moneda: USD confirmado.** Pero en la tienda el precio se muestra como `$1,200.00` **sin declarar moneda en pantalla** — ambiguo para un público hispanohablante.
- **Pasarela única: Authorize.Net CIM** (tarjeta de crédito). El nombre comercial visible para el comprador **NO EXISTE** en ninguna página pública.
- **Impuestos: NO EXISTEN** (`tax_lines: []`, sin leyenda de "precio final").
- **Cuotas, financiación, planes de pago: NO EXISTEN** en ninguna parte del sitio.

> **Hipótesis, NO confirmada:** que `$699` sea el precio "con Beca Studyx" y `$1,200` el de lista. El sitio nunca lo dice. Hay que preguntárselo a StudyX antes de que el agente cite cualquier número.

## B.4 Propuesta de valor — claims literales de la home

> `Sé parte de la academia online más grande de Estados Unidos`
> `100% en español`
> `Únete a Studyx y abrete a un mundo profesional, aprendizaje flexible, a tu propio ritmo.`
> `Obten nuestra certificacion y genera ingresos extra.`
> `Aprendizaje flexible - Maneja tu ritmo de aprendizaje.`
> `Certificación verificada - Certificado físico y digital.`
> `Profesores expertos - Apoyo durante toda tu cursada.`
> `Aplica a nuestro programa Enterprise y sé parte de la tecnología de educación más avanzada.`
> `Aplica ahora y comienza a estudiar entre más de 50 diplomados online`
> `Uno de nuestros expertos se pondrá en contacto contigo a la brevedad.`

**Texto institucional (repetido en las 28 fichas, con sus faltas de ortografía originales):**
> `Studyx es la nueva tendencia en estudios online. Diseñado en detalle para que los usuarios vivan una experiencia unica y personalizada. Somos el impulso de inspiracion, para tu desarrollo personal y profesional. Aquí descubrirás los beneficios de certificarte en EEUU; la importancia de formalizar y validar tus conocimientos, seremos ese puente que une tus proyectos a la realidad. Miles de alumnos nos eligen dia a dia colocando a studyx en el centro de nuestra comunidad hispanohablante. Se parte del mañana, unete a Studyx y abrete al mundo.`

### Beca Studyx — el mecanismo de descuento existe y está gated

> `¿Cómo aplico a mi Beca Studyx?`
> **`Puedes aplicar únicamente con asistencia del departamento de inscripciones.`**

Requisitos publicados:
1. `Entregar tus proyectos - Completar tus proyectos prácticos en tiempo y forma.`
2. `75% de asistencia en tu diplomado - La asistencia a tus clases en vivo y grabadas son importantes.`
3. `Aprobar tus exámenes - Sobre un mínimo de 6 sobre 10 exámenes prácticos.`

**Monto o porcentaje de la beca: NO EXISTE.** Y es explícitamente un mecanismo que solo se activa hablando con una persona — es decir, exactamente el trabajo del agente de ventas.

### Programa Enterprise

> `Nuestros Alumnos Enterprise, podrán solicitar sin costo adicional el diploma fisico, el cual sera enviado por Fedex` *(sic)*

**Página de planes, precios o condiciones Enterprise: NO EXISTE.**

## B.5 Certificación — el claim y su desmentida

**Home:**
> `Certificación verificada - Certificado físico y digital.`
> `Certificamos tus logros`
> `Una vez completado y aprobado tu diplomado, recibirás tu certificado digital.`

**Términos y condiciones, literal:**
> `No somos una entidad educativa con licencia para brindar títulos, certificados con aval nacional`
> `nuestros cursos/capacitaciones, no obtienen un certificado o licencia para poder ejercer dichos aprendizajes`

Las 28 fichas muestran una **imagen** de certificado (`certificado-1024x723.jpeg`) **sin ningún texto** que describa qué certifica, quién lo emite ni qué validez tiene.

## B.6 Legales, devoluciones y consentimiento

| Documento | Fecha | Contenido literal relevante |
|---|---|---|
| Políticas de devolución | `Última actualización: 1 de enero de 2023` | **`All sales are final and no refund will be issued.`** *(en inglés)* |
| Términos y condiciones | s/f | `los productos digitales... no poseen devolución del dinero` **pero** `si Studyx comprueba que hubiese un error de cobro... Studyx se responsabiliza... hacer el reembolso total del dinero` |
| Políticas de privacidad | `January 01, 2023` | `We contact the people who fill out the form trough calls and SMS.` *(sic)* |

**El consentimiento del formulario, literal:**
> `Al llenar este formulario, nos das tu consentimiento para comunicarnos contigo por SMS.`

**Menciones a WhatsApp en el consentimiento, en la privacidad o en los T&C: NO EXISTEN.**
**Menciones a Authorize.net, PayPal, Stripe o cualquier procesador de pagos en la política de privacidad: NO EXISTEN.**

## B.7 Estado técnico del sitio — lo que rompe el embudo

| Hallazgo | Evidencia literal |
|---|---|
| **Registro deshabilitado** | `/student-registration/` → `Registration disabled. Please ask site admin to enable registration.` Es el destino de **todos** los CTA "Register" del sitio. |
| **Dos sistemas de compra simultáneos** | WooCommerce (`/cart`, `/checkout`) **y** Tutor LMS (`/cart-2/`, `/checkout-2/`). El de Tutor devuelve `No payment method found. Please contact the site administrator.` |
| **Campus = Tutor LMS, no Moodle** | `/wp-json/` expone el namespace `tutor/v1`. Pero la home enlaza a descargar **la app de Moodle** en Play Store y App Store. |
| **Error de login pre-renderizado** | `/campus` muestra `Los datos ingresados no corresponden con nuestros registros` **sin haber enviado el formulario**. |
| **Contaminación cruzada de contenido** | `/diplomado/auxiliar-de-farmacia/` y `/diplomado/home-maintenance/` insertan el bloque de producto de **"Asistente y Cuidador de Adultos Mayores"** con su precio, valoración y temario de geriatría. |
| **Contenido ajeno inyectado** | En Asistente y Cuidador de Adultos Mayores, la Clase 04 termina con la frase `CÓMO DESACTIVAR SECURE BOOT.` |
| **Página publicada vacía** | `/diplomado/organizador-profesional-de-eventos-sociales/`: el H3 "Objetivos del diplomado" existe y está vacío. Cero texto propio del curso. |
| **Slug reciclado** | `Diseño gráfico en Coreldraw` vive en `/diplomado/community-manager/`. **No existe ningún diplomado de Community Manager publicado.** |
| **URLs duplicadas** | `/product/barista/` y `/producto/barista/` responden ambas 200 con el mismo contenido. |
| **3 cursos con el mismo texto** | Photoshop, Ilustrator y Coreldraw comparten **palabra por palabra** el mismo "Objetivos del diplomado", sin una sola mención al software. Las fichas no permiten distinguirlos. |
| **Modalidad contradicha** | Las 28 fichas declaran `Online en vivo`, y describen contenido asincrónico. **Horarios, fechas de inicio o calendario: NO EXISTEN en ninguna ficha.** |
| **Errores en producción** | `Home Maintenence` · `Ilustrator` · `Compañia` · `diploma fisico` · `sera enviado` · `Seleccione su pais` |
| **Valoraciones idénticas** | `Valorado con 4.5 de 5` en todas las fichas que la muestran. Google real: **4.7 sobre 17 reseñas**. |

**Landings sueltas encontradas, no enlazadas en el menú:**
- `/pagina-calendly/` → `45 MINUTOS DE ASESORÍA GRATIS` · `Reclama tu sesión GRATIS de 45 minutos de estrategia sin obligaciones (Valorada en $500). Esto es estrictamente para personas con hambre convertirse en un interiorista éxitoso` *(sic)* · **el embed de Calendly no carga**
- `/thanksgiving-cupon/` → protegida por contraseña. Evidencia de campañas con cupón cuyo contenido no es auditable.

## B.8 Prueba social publicada

**Testimonios (5, verbatim, con nombres):** Amanda Gutierrez · Omar Dominguez · Ailiim Carp · odelaisis hernandez · naanim montecinos.

Uno de ellos es material de ventas directo:
> Omar Dominguez: *"Agradecido por el excelente diplomado me ayudo a despegar laboralmente y ahora soy mi propio jefe, lo recomiendo a ojos cerrados ahora ya voy con mi segundo diplomado aumentando mis servicios en decoración de interiores y exteriores"*

**Casos de éxito (3):** Felipe Serrano (Academia de Oficios — instalación de paneles solares) · Cristian y Ana Maria (Academia gastronómica — catering y pastelería) · Amparo y Edson (**Academia de Diseño informático** — diseñadores gráficos).

---

# PARTE C — El cruce

## C.1 Bloqueadores del proyecto que el sitio YA RESPONDE

| Bloqueador declarado en contexto | Lo que dice el sitio | Estado real |
|---|---|---|
| *"Entidad legal y país de cobro — Argentina no está en la lista de Stripe"* | `My Study X, LLC` / `World Digital Group Corp`, **South Florida**, ley y tribunal de EE.UU., domicilio en Sunny Isles Beach FL | **Resuelto en los hechos.** La entidad de cobro es estadounidense. La premisa argentina era incorrecta. |
| *"Decisión PSP (Mercado Pago vs Stripe)"* | `payment_methods: ["authorize_net_cim_credit_card"]` — **Authorize.Net CIM ya está en producción** | **Ya decidido, y por un tercero.** No es Stripe ni Mercado Pago. |
| *"Moneda"* | `currency_code: "USD"` | **Resuelto:** USD, 2 decimales, sin impuestos configurados |
| *"Catálogo real"* | 30 productos a `$1,200.00`; 28 fichas a `$699.00USD` | **Existe, pero es inconsistente.** Ver C.2. |
| *"Copy de consentimiento"* | `Al llenar este formulario, nos das tu consentimiento para comunicarnos contigo por SMS.` | **Existe, y NO cubre WhatsApp.** Ver C.3. |

**Esto es lo más accionable de todo el análisis:** tres de los cinco bloqueadores externos que frenaron el proyecto durante dos semanas tenían respuesta pública. El JSON de Retell menciona "Stripe" en **6 campos distintos** — los seis están mal.

## C.2 Contexto vs. sitio, campo por campo

| Afirmación del contexto | Sitio oficial | Veredicto |
|---|---|---|
| 9 academias | 6 categorías. Faltan **negocios**, **cultural** y **diseño informático** *(esta última aparece solo en un caso de éxito)* | ⚠️ Parcial |
| 14 cursos en `boosted_keywords` | **8 existen**; **6 NO existen**: reparación de celulares, aires acondicionados, cámaras de seguridad, community manager, Excel, criptomonedas | ❌ **43 % del vocabulario del agente de voz apunta a cursos inexistentes** |
| "clases grabadas" | `Online en vivo` en las 28 fichas | ❌ Contradicción |
| "ritmo propio" | `Aprendizaje flexible - Maneja tu ritmo de aprendizaje` | ✅ Confirmado |
| "sin vencimiento" | **NO EXISTE** en ninguna página | ❓ Sin respaldo |
| "desde celular o compu" | App de **Moodle** enlazada, pero el campus es **Tutor LMS** | ⚠️ Inconsistente |
| "ejercicios y exámenes" | `Actividades prácticas con exámenes parciales y Final` en las 28 | ✅ Confirmado |
| "profesores que responden consultas" | `Profesores expertos - Apoyo durante toda tu cursada` | ✅ Confirmado |
| "certificado de la academia, no título oficial" | T&C: `No somos una entidad educativa con licencia...` | ✅ **Confirmado — y es la formulación jurídicamente correcta** |
| "pago contado o **en cuotas**" | **Cuotas: NO EXISTEN** en shop, producto, carrito ni T&C | ❌ **El agente prometería algo que no se puede cobrar** |
| "moneda por defecto USD" | `currency_code: "USD"` | ✅ Confirmado |
| "handoff post-pago = fila del Excel" | Registro self-serve deshabilitado ⇒ el alta es manual sí o sí | ✅ **Validado por la realidad operativa** |

## C.3 Contradicciones internas del sitio, ordenadas por riesgo

| # | Contradicción | Riesgo |
|---|---|---|
| 1 | **$699 publicado vs $1.200 cobrado** | 🔴 Comercial y legal. Publicidad engañosa. Ningún agente puede citar precio hasta resolverlo. |
| 2 | **Consentimiento SMS/llamadas vs canal WhatsApp** | 🔴 Regulatorio. Meta puede suspender la WABA; el opt-in no cubre el canal. |
| 3 | **"Certificación verificada" vs "no obtienen un certificado o licencia"** | 🔴 Legal. Define el límite duro de lo que el agente puede prometer. |
| 4 | **`All sales are final` vs `reembolso total del dinero` en T&C** | 🟠 El agente no puede responder "¿tiene devolución?" sin una regla escrita. Además la política está **en inglés** en un sitio "100% en español". |
| 5 | **`más de 50 diplomados` vs 30 reales** | 🟠 Claim inflado 67 %. El agente no debe repetirlo. |
| 6 | **`Online en vivo` sin un solo horario publicado** | 🟠 Primera objeción previsible: *"¿a qué hora son las clases?"*. Hoy no hay respuesta. |
| 7 | **Registro deshabilitado + doble checkout + Tutor sin pasarela** | 🟠 Operativo. El embudo se corta después del pago. |
| 8 | **Programa Enterprise y Beca sin página, precio ni monto** | 🟡 Son las dos palancas de venta y no están documentadas en ningún lado. |
| 9 | **13 de 28 cursos sin temario publicado** | 🟡 El agente no puede responder "¿qué se ve en el curso?" para la mitad del catálogo. |
| 10 | **Contaminación de contenido y slugs reciclados** | 🟡 Cualquier scraping ingenuo de `/diplomado/` produce datos falsos. Ver C.4. |

## C.4 Advertencia técnica: no scrapear este sitio para armar el catálogo

Es tentador poblar el catálogo determinístico (entregable C1) leyendo `/diplomado/`. **No hay que hacerlo.** Un scraper obtendría:

- Que **Auxiliar de Farmacia** cuesta $699 y trata sobre geriatría *(bloque de producto contaminado)*
- Que existe un curso de **Community Manager** *(slug reciclado)*
- Que **Photoshop, Illustrator y Coreldraw** son el mismo curso *(descripción idéntica)*
- Que **Decoración de Interiores** tiene 34 clases y 20 temas *(discrepancia sin resolver)*
- Precios equivocados en el **100 %** de los casos donde hay precio

**El catálogo tiene que venir de StudyX en un archivo firmado, no del sitio.** El sitio sirve para *auditar* lo que StudyX entregue, no para reemplazarlo.

---

# PARTE D — Qué cambia esto en el proyecto

## D.1 Correcciones inmediatas al plan vigente

| # | Acción | Doc afectado |
|---|---|---|
| 1 | **Cerrar el bloqueador A3 (PSP)** con el dato real: Authorize.Net CIM, entidad LLC de Florida, USD. Confirmar con StudyX si el agente cobra por esa misma pasarela o por una nueva | `ANALISIS-PLAN-Y-ENTREGABLES.md` Pista A |
| 2 | **Corregir "Stripe" en los 6 campos del JSON de Retell** (`version_description`, `general_prompt`, descripción de `enviar_link_pago`, dos de `post_call_analysis_data`, `boosted_keywords`) | `AGENTE-B-VOZ...md` §3.1 ítem 10 |
| 3 | **Reemplazar los `boosted_keywords`**: sacar los 6 cursos inexistentes, agregar los ~20 reales que faltan | `AGENTE-B-VOZ...md` §1.7 |
| 4 | **Bloquear `enviar_link_pago` en modo "cuotas"** hasta que StudyX confirme si existen. Hoy el sitio no las tiene | `AGENTE-B-VOZ...md` §1.7 |
| 5 | **Rediseñar el opt-in.** El actual dice SMS. Para WhatsApp hace falta texto nuevo, capturado en el formulario, con fuente/fecha/texto guardados desde el día uno | Pista A ítem A4 |
| 6 | **Escribir `POLITICA-COMERCIAL.md` con las citas literales de los T&C**, no con paráfrasis. La frase *"no obtienen un certificado o licencia para poder ejercer"* es el límite duro | `AGENTE-B-VOZ...md` §1.8 |
| 7 | **Confirmar que el nodo Excel es el fulfillment real.** El registro self-serve está deshabilitado: no hay alta automática posible aunque se quisiera | `ORQUESTADOR-MAPA-Y-ARRANQUE.md` §2 |

## D.2 Lo que el agente debe poder decir, y lo que no

**Puede decir** (respaldado por el sitio): modalidad online y a ritmo propio · cantidad de clases por diplomado · temario **solo de los 15 cursos que lo publican** · que hay profesores que acompañan · que se emite un **certificado de la academia** · que la moneda es USD · que se paga con tarjeta.

**No puede decir, bajo ninguna circunstancia:**
- Ningún **precio** hasta que StudyX resuelva $699 vs $1.200
- **"Certificación verificada"**, "aval", "título", "homologación", "matrícula" — los T&C lo prohíben explícitamente
- **"Más de 50 diplomados"** — son 30
- **Cuotas o financiación** — no existen
- **Horarios o fechas de clases en vivo** — no existen publicados
- **Monto o porcentaje de la beca** — no existe publicado
- Nada sobre **devoluciones** hasta que se resuelva la contradicción entre los dos documentos

## D.3 Lo que el sitio le regala al agente

Tres cosas que valen y que el proyecto todavía no usa:

1. **La Beca Studyx es literalmente un mecanismo de descuento gated por conversación** — *"únicamente con asistencia del departamento de inscripciones"*. Es el cierre natural del agente, y probablemente la explicación del precio dual. Necesita reglas escritas.
2. **`/pagina-calendly/` prueba que ya hubo un embudo de "asesoría gratis de 45 minutos"**, valorada en $500, segmentada por vertical (interiorismo). Es un patrón de calificación reusable, y hoy está roto (el embed no carga).
3. **Los tres casos de éxito y los cinco testimonios son material de manejo de objeciones ya aprobado y publicado**, con nombre y vertical. Entran directo al corpus de conocimiento (entregable A5).

---

# PARTE E — Lo que hay que pedirle a StudyX

Ordenado por lo que más bloquea. Sin estas respuestas, **ningún precio que salga del sistema puede ser real** (decisión D3 sigue vigente y ahora está confirmada por evidencia).

| # | Pregunta | Bloquea |
|---|---|---|
| 1 | **¿$699 o $1.200?** ¿Es lista vs. beca? ¿Cuál se cobra realmente hoy? | Catálogo determinístico (C1) — todo |
| 2 | **Beca Studyx: ¿monto, criterio de otorgamiento, quién autoriza, hay tope?** | Cierre de venta |
| 3 | **¿Existen cuotas?** Si sí, ¿cuántas, con qué recargo, por qué pasarela? | `enviar_link_pago` |
| 4 | **¿El agente cobra por la misma cuenta de Authorize.Net del sitio o por una nueva?** | Adapter de pagos, webhook |
| 5 | **Texto exacto del certificado** y qué se puede prometer sin contradecir los T&C | Política comercial, prompts de A y B |
| 6 | **¿Las clases son en vivo o grabadas?** Si son en vivo: horarios, días, plataforma | Primera objeción del embudo |
| 7 | **Catálogo oficial firmado**: los 30 cursos con nombre canónico, categoría, clases, temario y precio | C1, `consultar_curso`, `consultar_oferta` |
| 8 | **¿Qué pasa con los 6 cursos del agente de voz que no están en el sitio?** ¿Se discontinuaron, están por salir, o el JSON quedó viejo? | `boosted_keywords`, catálogo |
| 9 | **Origen de los teléfonos de los leads y texto del opt-in actual.** ¿Hay consentimiento de WhatsApp en algún lado que no esté en el sitio? | Invariante #4, WABA |
| 10 | **Devoluciones: ¿cuál política rige?** ¿"All sales are final" o el reembolso por error de cobro de los T&C? | Manejo de reclamos |
| 11 | **Programa Enterprise: ¿qué es, cuánto cuesta, qué incluye además del diploma físico por FedEx?** | Upsell |
| 12 | **Alta del alumno: ¿cómo se hace hoy, con el registro deshabilitado?** ¿Quién la hace, en qué plataforma, con qué SLA? | Fulfillment, nodo Excel |
| 13 | **¿El +1 (866) 217-7282 es el número previsto para la WABA?** | Habilitación de Meta |

---

## Anexo — Nota de método

Extracción realizada el 14-ago-2026 exclusivamente con WebFetch sobre `https://mystudyx.com`, respetando `robots.txt`. Se recorrieron la home, `/diplomados/`, 23 fichas `/diplomado/`, `/shop` (páginas 1 y 2), fichas `/product/`, `/cart`, `/checkout`, `/cart-2`, `/checkout-2`, `/student-registration/`, `/campus`, `/campus-virtual`, los tres documentos legales, dos landings no enlazadas, `robots.txt` y la Store API pública de WooCommerce.

**Limitaciones declaradas:**
- No se pudo renderizar un checkout **con producto cargado** (`robots.txt` bloquea `?add-to-cart=`), así que la experiencia de pago real no fue observada de punta a punta.
- `wp-sitemap.xml` devuelve binario ilegible para WebFetch: **el inventario de páginas del sitio queda incompleto**. Pueden existir landings adicionales no detectadas.
- Los PDFs de "Descargar programa" no fueron procesados. Contienen el temario de los 13 cursos que no lo publican en HTML.
- 2 de los 28 diplomados (`Curso de Electricista`, `Publicidad en las Redes Sociales`) no fueron extraídos ficha por ficha; sí figuran en la tienda a $1.200.
- `/thanksgiving-cupon/` está protegida por contraseña: los cupones y su vigencia no son auditables.

Ninguna afirmación de este documento proviene de conocimiento previo sobre StudyX. Todo dato del sitio está transcrito o marcado como inexistente.
