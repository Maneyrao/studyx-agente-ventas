<!--
SYNC IMPACT REPORT
==================
Version change: [TEMPLATE] → 1.0.0
Added sections:
  - Core Principles (8 principles, complete)
  - Architecture Constraints
  - Governance
Modified principles: N/A (initial population from template)
Removed sections: N/A
Templates reviewed:
  - .specify/templates/plan-template.md ✅ no changes needed (Constitution Check section is generic)
  - .specify/templates/spec-template.md ✅ no changes needed
  - .specify/templates/tasks-template.md ✅ no changes needed (Phase N security hardening task retained)
Deferred TODOs:
  - None
-->

# StudyX Agente de Ventas — Constitution

## Core Principles

### I. Fuente Única de Verdad

El orquestador es el único componente autorizado para tomar decisiones de negocio,
acceder a la base de datos y comunicarse con APIs externas.

Los agentes conversacionales (Botpress para texto, Retell para voz) son exclusivamente
"bocas y oídos": reciben instrucciones del orquestador y envían mensajes al usuario.
NUNCA acceden directamente a la base de datos ni a APIs externas. NUNCA se comunican
entre sí; toda interacción pasa obligatoriamente a través del orquestador.

**Rationale**: Centralizar la lógica de negocio elimina estados contradictorios,
simplifica la auditoría y hace que la seguridad sea verificable en un único punto.

### II. Menor Privilegio

Cada agente conversacional puede invocar únicamente el conjunto explícito y acotado
de herramientas (tools) que el orquestador le expone para su rol. No existe ninguna
herramienta de propósito general ni acceso al sistema operativo.

Esta restricción es estructural, no basada en instrucciones de prompt: incluso si un
prompt es vulnerado (jailbreak), el agente no puede ejecutar ninguna acción fuera de
su set de herramientas registrado.

**Rationale**: La seguridad por capas garantiza que una vulneración de prompt sea
contenida sin comprometer el sistema subyacente.

### III. Identidad y Segundo Factor

La identidad primaria se ancla al número de teléfono WhatsApp, pero el teléfono se
considera falsificable por defecto.

Toda acción sensible — entregar datos de cuenta, modificar datos de perfil, emitir un
reset de contraseña — DEBE requerir un segundo factor liviano: confirmación del email
registrado o un código OTP de un solo uso. Un agente NUNCA lee ni transmite una
contraseña completa en ninguna dirección.

**Rationale**: Separar "quién dice ser" (teléfono) de "quién puede probar ser" (2FA)
protege a usuarios cuyo número sea suplantado o cuyo dispositivo sea comprometido.

### IV. Nunca Eliminar Datos

Los comandos `DELETE` sobre tablas críticas están prohibidos por diseño de credenciales,
no por instrucción de prompt. El orquestador opera con permisos de base de datos
`INSERT`/`UPDATE` únicamente.

Toda eliminación lógica se implementa como soft-delete mediante columna `deleted_at`.
Toda operación de escritura queda registrada en un `audit_log` append-only e inmutable
al que el orquestador tampoco puede hacer `DELETE`.

**Rationale**: La inmutabilidad del historial permite auditoría forense, cumplimiento
regulatorio y recuperación ante errores operacionales o fraude.

### V. Validación de Webhooks

Todo endpoint que recibe webhooks entrantes — pagos (MercadoPago, Stripe), eventos de
voz (Retell), mensajería (WhatsApp/Meta) — DEBE validar la firma o secreto del
proveedor antes de ejecutar cualquier lógica de negocio. Las solicitudes sin firma
válida se rechazan con `401` sin procesar su contenido.

**Rationale**: Un endpoint sin validar es una puerta abierta a inyección de eventos
falsos (pagos ficticios, llamadas fantasma, mensajes spoofed).

### VI. Aislamiento de Memoria

Toda consulta a la memoria de largo plazo (vector store, base de datos de contexto)
DEBE incluir obligatoriamente un filtro por `contact_id` del propietario de esa
memoria. Recuperar o exponer memoria sin ese filtro se considera una fuga de datos
y constituye una violación crítica.

**Rationale**: Sin aislamiento por propietario, una consulta mal construida puede
devolver el historial o los datos personales de otro usuario.

### VII. Scope Acotado

Los agentes conversacionales responden únicamente sobre el dominio del negocio:
cursos disponibles, precios, procesos de compra, soporte postventa y gestión de cuenta.
Toda información que comuniquen proviene exclusivamente de datos provistos por el
orquestador a través de sus herramientas.

Los agentes NUNCA inventan información (cursos inexistentes, precios estimados, datos
de cuenta no confirmados). Si la información no está disponible, derivan la consulta a
un operador humano. La alucinación es una violación del principio.

**Rationale**: En un contexto de ventas y datos de cuenta, la información incorrecta
genera pérdida de confianza, disputas económicas y problemas legales.

### VIII. Acciones Irreversibles a Humano

Ninguna baja de cuenta, cancelación de suscripción, reembolso, modificación de
accesos o acción sobre dinero se ejecuta de forma automática. Estas solicitudes
generan un ticket en el sistema de gestión y son derivadas obligatoriamente a un
operador humano para su aprobación y ejecución.

**Rationale**: Las acciones irreversibles o con impacto económico requieren
supervisión humana para evitar fraudes, errores y disputas.

## Architecture Constraints

Estas restricciones son consecuencias directas de los principios anteriores y DEBEN
ser verificadas en cada revisión de diseño e implementación:

- El orquestador expone una API interna (HTTP/gRPC) tipada; los agentes son clientes
  de esa API exclusivamente.
- Ningún agente tiene acceso a variables de entorno con credenciales de base de datos
  o APIs externas.
- La tabla `audit_log` usa un usuario de base de datos diferente al del orquestador,
  con permisos `INSERT` únicamente; el orquestador no puede borrar ni modificar filas.
- Los webhooks de pago DEBEN validarse en middleware antes de llegar al handler de
  negocio; no es responsabilidad del handler validar.
- La capa de memoria (RAG/vector store) DEBE rechazar queries sin filtro `contact_id`
  en tiempo de ejecución, no solo por convención.

## Governance

Esta constitución es la fuente de verdad para decisiones de diseño y seguridad del
sistema. Tiene precedencia sobre cualquier otra documentación, convención de equipo o
instrucción de agente.

**Enmiendas**: Cualquier modificación a un principio requiere:
1. Propuesta escrita con justificación técnica o de negocio.
2. Revisión por al menos un miembro del equipo de arquitectura.
3. Actualización de version semántica (MAJOR si se elimina o redefine un principio,
   MINOR si se agrega uno nuevo, PATCH para aclaraciones).
4. Propagación a templates y artefactos dependientes.

**Versionado semántico**:
- `MAJOR`: Eliminación o redefinición incompatible de un principio.
- `MINOR`: Nuevo principio o sección con impacto material en implementaciones.
- `PATCH`: Aclaraciones, correcciones de redacción, reformulaciones sin cambio semántico.

**Revisión de cumplimiento**: Todo plan de implementación (plan.md) DEBE incluir un
"Constitution Check" que liste explícitamente cómo cada principio relevante se satisface
o justifica su excepción. Las excepciones sin justificación bloquean la aprobación del
plan.

**Version**: 1.0.0 | **Ratified**: 2026-06-23 | **Last Amended**: 2026-06-23
