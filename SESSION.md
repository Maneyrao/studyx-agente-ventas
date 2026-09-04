# Sesión StudyX

## Estado
Agente A plannerless V2: **READY_FOR_LOCAL_REVIEW**. Hay un candidato verificable; no se aprobó ni ejecutó el rollout o Telegram. Rama `codex/agent-a-plannerless-v2`, worktree `agent-a-plannerless-v2`. Entrada limpia en `ad15baafb63e8c55cb877f943a74e57c2899deda`; candidato intermedio `360cd37201a35bf3c4cceb82a93e809885494529` y evidencia histórica preservados. El commit que contiene este archivo registra el cierre actual.

## Cambios comprobados
- Se eliminaron falsos verdes de disponibilidad, entrega y opt-out. Un HTTP200 o una fila outbound no demuestra entrega; un fallo del modelo no equivale a atención exitosa.
- Elegir plan o aportar datos no autoriza link. Postergar o cambiar curso retira permiso. El teléfono declarado se guarda separado de la identidad sintética. Aviso de pago no significa acreditación.
- Se corrigieron esquema/correlación de reparaciones, poda por contenido, precios equivalentes con céntimos cero, descriptores de áreas del catálogo y condiciones de acreditación.
- Intake reconoce formularios personales con etiquetas, comas, punto y coma o saltos de línea; rechaza encabezados negados, cursos y terceros ambiguos.
- El prompt completo mantiene 322 líneas. Se reconciliaron contradicciones de precio, cierre, consentimiento, acceso, seguimiento y llamadas. No se añadió planner ni plantilla comercial.
- Después de las pagas se corrigió call_offer: un texto informativo no consume cupo ni abre espera. Las ofertas reales siguen bloqueadas al agotar cupo/rechazar llamada; la negación se acota a su segmento. Los intentos intermedios fallidos y su revisión quedan conservados.

## Fuente final
Brain V19 / canónico V8. Modelo deepseek-v4-flash, Responses, max800, temperature0.2, reasoning none, sin streaming.
Freeze `2026-09-04T15:47:41.402662+00:00`, digest `a98f6e57ce2604c3cde29c5595c11ffee5598e26679516c3acfb83e80625430e`.
Next `IrwZGDZAUGAKWeW7Jjxmn`; ADK local `b9376e34f04dc8d2cc47c587e9576b58140f057cf78658e60fd7f3c881c3fdf1`.
Canónico SHA `67adca0e95055f32943717af84cb22d211a624c631eb79848cf296c688ffa575`.
La última paga usa el freeze anterior V19 (`5deffc…`); no atribuirla al arreglo del contador posterior.

## Evidencia y resultados
Informe principal: `docs/reports/2026-09-04-agent-a-live-candidate.md`. Paquete: `docs/reports/evidence/2026-09-04-agent-a-live/`, con manifiesto, hashes, transcripciones, borradores, DB y captura. Medición y rúbrica independiente: `live-measurement` y `final-v19-review` de la misma fecha.
V19 pagado: 7 conversaciones, 31 entradas, 32 HTTP, disponibilidad/fallback0, p95 4157ms, reparación1/31 (3,23%), éxito1/1. Gates numéricos agregados aprobados; submuestra V2 falla con repair25%. **Calidad no aprobada:** menú repetido y anticipación verbal de pago. No se certifica estabilidad.
Primer H1 falló por nombre no persistido; H2 pasó. Primera V2 falló con formulario multilínea; primera V3 pasó funcionalmente con repair25%. Las repeticiones posteriores son regresiones y no sustituyen esos resultados.
Fuente final gratis: 2531 unitarias/contratos aprobados, 7 skip, 7 TODO. Integración completa anterior: 353 aprobadas/1 skip; después del último cambio pasaron 20 integraciones relevantes. Workflow3/3, incluido ledger de cuatro turnos0/1/1/1 y caída503/replay. Lint, typechecks, Next build, ADK check/build y dry-run aprobados. Nada de esto demuestra Telegram.

## Presupuesto y laboratorio
**Tope acumulado USD1. Gasto conservador final USD0,823283696; restante USD0,176716304.** Incluye USD0,38 previos informados. Ledger original `botpress-agent/evals/results/campaign-budget-20260904.json`: 239 reservas, 237 HTTP conciliados y dos intentos históricos; reserva de aborto sin usage conservada. SHA `d118ddc49db2aa7ba3aa480809f3b4dcbebb5d5cfc6b0da8b56d2a19f8c41332`. No hubo API después del cierre V19; no reiniciar presupuesto.
La clave local ya funciona; no volver a pedirla ni mostrarla. El runner lee sólo DEEPSEEK_API_KEY de `.eval/.env.local`. API3217 y PostgreSQL55435/studyx_test están aislados, con pago fake y captura local. No cargar entorno productivo.
Se preservó el laboratorio original y se creó `studyx_integration_20260904` para integración sin conversaciones previas. Queda documentado el riesgo de starvation del reconciliador con 141 claims vencidos y límite100. No se probaron embeddings, Sheets, llamadas ni cobros reales.

## Condiciones para continuar externamente
No hubo migración, push, merge, deploy Vercel/Botpress ni Telegram. El preflight de Supabase `eqspozrpzgzvtpowwprg` encontró ausente declared_phone. El paso5 del traspaso exige autorización explícita para `20260904010001_contacts_declared_phone.sql`; «listo» confirmó sólo la clave.
Vercel anterior identificado: `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`. El bundle ADK productivo del3/9 no se recuperó. Hay alternativa offline desde360cd37, compilada y archivada con configuración sanitizada, pero no es copia del anterior ni está autorizada como recuperación; conserva defectos V14 conocidos. Scratch: `/private/tmp/studyx-recovery-360cd37-20260904`.
Seguir `2026-09-04-agent-a-rollout-canary.md`: resolver autorización de migración, recuperación aceptada y gates de calidad antes de publicar. No pedir canario contra el bundle anterior. Remotos personal/Maneyrao y Lucas identificados; no adivinar destino Git.

Historial previo conservado en `docs/reports/evidence/2026-09-04-agent-a/SESSION-before.md`; otros proyectos no revalidados.
