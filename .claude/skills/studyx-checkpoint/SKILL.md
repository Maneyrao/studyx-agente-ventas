---
name: studyx-checkpoint
description: Cerrar una fase del plan de 20 fases de StudyX. Usar al terminar cualquier fase, antes de compactar el contexto, o antes de arrancar una sesión nueva. Corre las verificaciones, hace commit y escribe el resumen de estado que sobrevive al reinicio de contexto.
---

# Checkpoint de fase StudyX

No existe una clave de configuración para decirle a `/compact` qué priorizar.
El sustituto es este checkpoint: dejar por escrito lo que la próxima sesión
necesita, para poder tirar el contexto sin perder nada.

## Secuencia

### 1. Verificar (no negociable)
```bash
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```
Si toca `botpress-agent/`: `cd botpress-agent && npm run typecheck && npm run check`
Si toca migraciones: `npm run test:db:reset-loop && npm run test:db:invariants`

No se cierra una fase con algo en rojo. Ahorrar tokens nunca justifica saltear
una verificación.

### 2. Ver qué cambió, barato
```bash
git status --short
git diff --stat
```
Leer el diff completo sólo de los archivos donde haga falta decidir algo.

### 3. Commit
Un commit por fase, mensaje `phase(<n>): <qué quedó funcionando>`.

### 4. Actualizar SESSION.md
Sobrescribir con esta estructura, y NADA más:

```markdown
# Sesión StudyX

## Fase actual
PHASE <n> — <nombre>. Estado: <completa | en curso>

## Fases completas
- PHASE <n>: <una línea de qué quedó funcionando + su evidencia>

## Decisiones de arquitectura tomadas
- <decisión> → <por qué> → <dónde vive en el código>

## Invariantes establecidas en esta fase
- <invariante> → <qué la hace cumplir: constraint, test, tipo>

## Tests agregados
- <archivo>: <qué demuestra>

## Bloqueos
- <bloqueo> → <qué intervención externa requiere>
```

### 5. Registrar hechos estables
Si se descubrió un hecho arquitectónico que se va a volver a necesitar
(un nombre de constraint, una firma, un límite de un proveedor), escribirlo
en la regla de `.claude/rules/` que corresponda. Nunca re-descubrir lo mismo
dos veces.

### 6. Compactar o arrancar limpio
Con SESSION.md actualizado y el commit hecho, el contexto es descartable.

## Qué NO escribir en SESSION.md
Callejones sin salida, salidas de comandos, hipótesis descartadas,
transcripciones. Sólo conclusiones y ubicaciones.
