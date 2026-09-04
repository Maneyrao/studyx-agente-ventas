# Agente A — candidato para prueba supervisada

El usuario autorizó desplegar para probar y reafirmó la prioridad de ofrecer llamada, continuar por chat ante rechazo, respetar las fases y enviar enlaces disponibles con información correcta. Esa instrucción autoriza el despliegue supervisado y la migración aditiva explicada previamente; no certifica producción ni autoriza cobros o llamadas reales.

## Candidato verificado

Brain V20, canónico V9 completo (322 líneas), SHA `6d724acf6e366571bc6ce94d5013d007654442a67562daf67e672542c1eba17b`. Se exige invitación inicial para selección o consulta de un curso conocido, incluso precargado, antes de diagnóstico/intake/cierre por chat. Veto y preferencia por chat prevalecen; máximo dos invitaciones. Los enlaces de pago los materializa el backend con consentimiento, curso/plan válidos e intake completo.

Se corrigieron tres causas observadas durante esta entrega:

- Ingesta Telegram registra `sandbox_identities` en la misma transacción: el adaptador de Sheets queda bloqueado antes de construir el cliente externo. Conflictos de identidad revierten la ingesta.
- Formularios con nombre y apellido en campos separados, sin exigir dos puntos, guardan la identidad; se preservan controles contra datos de terceros/negados.
- El filtro distingue el plazo mensual del pago de la duración académica. Conserva USD 60 durante seis meses cuando el plan canónico lo confirma, sin habilitar plazos o duraciones inventados. La validación de intake exige pedir campos faltantes; mencionar un nombre en un reconocimiento no cumple esa condición.

El primer intento V20 falló: nombre no persistido, cuota correcta podada por confusión con duración académica y reparación que pedía correo ya guardado. Se conserva completo. También se corrigió una aserción falsa: `/60/` aceptaba el total `360`; ahora exige el importe como número independiente.

La regresión final ejecutó `processInboundTurn` con DeepSeek y backend/PostgreSQL aislados: **8 turnos, 8 HTTP, 0 reparaciones, 0 silencios, p95 4400 ms**. Oferta inicial y rechazo persistidos (contador 1, preferencia chat); plan mensual de seis cuotas conservado; los cuatro datos guardados; un enlace del plan capturado y correlacionado con entrega durable. La última respuesta informa revisión humana del pago y condiciona acceso a acreditación. No se efectuó ningún cobro.

Transcripciones y JSON originales comprimidos: [evidencia](evidence/2026-09-04-agent-a-supervised/). El primer fallo y la repetición aprobada no son conversaciones independientes reservadas ni certificación de naturalidad. La muestra final no contiene reparaciones: su tasa de éxito es no evaluable, no 100 %.

Validación gratuita: 2565 unitarias/contratos y 44 integraciones relevantes aprobadas; luego 121 focales del guard/validador/resolver incluyen dos paráfrasis adicionales. Lint, Next build y ADK typecheck/check/build/dry-run aprobados. Freeze final de 316 archivos: `72a2d1cdae9eb12b2a5bb548a2993f1d9c6f43934d39c077e141869dcccfd334`; Next local `n4AG7eWnxPRzL0QlH6b7R`. Bundle ADK para publicar (contexto producción, 23128231 bytes): `4b4de7e17f9602ab814dbdd17fe16537361482ba135d10013b3bc0a5350f011c`.

## Estado remoto al preparar la publicación

Supabase `eqspozrpzgzvtpowwprg`: migración `20260904010001_contacts_declared_phone.sql` aplicada mediante CLI nativo a las 16:32:36 UTC. Relectura: columna text nullable, sin default; 56 migraciones y ninguna pendiente. Se conserva la columna ante rollback de código. Un dry-run previo falló por prepared statements en el pooler transaccional; se usó el pooler de sesión. El aviso posterior sobre caché Docker local no revirtió la migración, verificada por lectura.

Vercel anterior: `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`. Publicar en proyecto `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM`, con brain=true, shadow=false, contextScoping=false, repair=true, singleRoute=true, stateAssertions=true y conversationPipelineV1=false, como el laboratorio. Las tres variables de enlaces ya existen; se preservan. El ensayo es de recepción del enlace, sin pagarlo. `.eval/` y `.worktrees/` están excluidos explícitamente del upload.

Botpress STUDYX `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`: publicación sólo de código, con lectura previa sin drift, SHA exacto y verificación de preservación de configuración, 15 integraciones, dos plugins y esquemas. Telegram registrado como `amsterdam_reservas_bot`. El bundle previo remoto no es recuperable; contingencia: pausar automation preservando configuración y conservar backend anterior. También está archivado el candidato local d5b786a; no se presenta como copia del deploy remoto anterior.

La llamada real con Agente B/Retell continúa fuera de esta entrega. Se verifica ofrecimiento/consentimiento y continuidad por chat. No hay comando /reset implementado: /start o borrar/reabrir Telegram conserva identidad e historial. Para probar primera invitación desde cero hace falta identidad de prueba sin rechazo previo; con historial se respeta la preferencia guardada.

## Presupuesto y límites

Tope acumulado USD 1. Gasto conservador tras ambas corridas: **USD 0,858633752**, restante **USD 0,141366248**, 256 reservas, incluidos los USD 0,38 iniciales y la reserva histórica sin usage. El ledger no se reinició. El despliegue y el canario visible se registrarán debajo; la captura local no demuestra entrega en Telegram.
