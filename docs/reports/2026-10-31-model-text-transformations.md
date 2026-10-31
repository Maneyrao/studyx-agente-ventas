# Inventario de transformaciones después del modelo

Inspección sobre `d2c836a`, antes de modificar código. Las líneas siguientes
corresponden a esa base. Autoridad: `docs/authority/prompt-agente-a-studyx-v2.md`
(P) y `docs/authority/spec-backend-bonificacion.md` (B). El arquitecto revisó
el inventario antes de autorizar únicamente la corrección de voseo.

| Ruta / función y archivo:línea | Transformación | Clasificación | Autoridad y evaluación |
|---|---|---|---|
| `agent-a-brain.ts:869`, `normalizeCustomerFacingSpanishV1`; aplicado en :901/:935 | Elimina ¿ y ¡ en mensajes y oferta de llamada | ENTREGA TÉCNICA | P:15 lo exige. Conservar. |
| Misma función, mapa :835 | Reemplaza voseo por tuteo | ESTILO-REGISTRO | Contradice P:13. Única eliminación autorizada en este bloque. |
| `agent-a-brain.ts:896`, `normalizeStrictProposal` | Descarta burbujas completas con URL o `{{...}}` | HECHO + recorte | P:222 prohíbe URL del modelo; P:236 exige rechazo/reparación de prosa. El borrado silencioso completo no está autorizado expresamente. Pendiente, no cambiar. |
| Misma función :924 | Si queda vacío un pedido de link, inserta «Perfecto, te comparto…» | ESTILO-REGISTRO | Plantilla redactada por backend, contradice P:17/236. Pendiente. |
| Misma función :887 | Quita separadores de teléfono sin cambiar dígitos | HECHO (representación estructurada) | P:218 no autoriza inferir país/dígitos; no modifica prosa. Conservar. |
| Parseo de JSON, wrappers Markdown, metadatos/shape y `z.string().trim()` en contratos | Extrae propuesta y valida; elimina espacios exteriores | ENTREGA TÉCNICA | P:236 exige contrato estructurado. No es reescritura de palabras. |
| `resolve-agent-a-plannerless.ts:655`, `pruneKnownUnsupportedFactClaimsWithoutValidationV1` | Tras reparación fallida poda requisitos, logística y detalles no verificados del borrador anterior | HECHO + recorte | P:50/54 exige hechos autorizados; P:236 y B:71 requieren rechazo/reparación. Corrección factual silenciosa: marcar y no cambiar aún. |
| `agent-a-brain.ts:1539/1132/1675`, helpers removeUnsupported… | Quita subordinadas u oraciones con afirmaciones no verificadas | HECHO + recorte | Llamados por la poda anterior y composición alternativa. Misma salvedad P:50/236. No corrigen un precio inventado por otro precio. |
| `processInboundTurn.ts:327`, `literalConversationVariants`; llamadas :1794/:2539 | Produce subconjuntos de mensajes/oraciones, conservando palabras, tras rechazo; revalida candidatos | HECHO + recorte de redacción | P:236/B:71 atribuye reparación al agente. Puede alterar sentido aunque conserve palabras. Pendiente. |
| `agent-a-brain.ts:1149`, `buildSafeAgentABrainCompositionV1` (:1155) | Compacta blancos y reemplaza correo por «tu correo» | ENTREGA TÉCNICA + HECHO/ESTILO | Ruta canónica alternativa, no todo plannerless. Espacios son formato; reemplazo de correo cambia contenido y puede contradecir resumen de datos P:220. Pendiente. |
| Misma composición :1210–1235, `canonicalPrerequisiteStatement`, `transactionalFallback`, `safeContextualOpening` | Filtra afirmaciones y agrega frase de requisitos/apertura fija si falta texto | HECHO + ESTILO-REGISTRO | Hechos P:50; prosa fija sin generación P:17/236. No presentarlo como conducta autorizada por comentario del código. Pendiente. |
| `canonical-response-assembler.ts:283`, `assembleCanonicalConversationResponseV1` | Ruta pipeline canónico: limpia afirmaciones, añade hechos seleccionados omitidos, bullets, preguntas y aperturas fijas | HECHO + ESTILO-REGISTRO | P:50 autoriza hechos, no toda prosa. P:236 sólo admite valores canónicos inmutables expresamente autorizados. Pendiente. Las normalizaciones :58 son para comparar, no reescritura visible. |
| `decision.service.ts:495`, `proseWithoutUrls` | Elimina oraciones con enlaces o anuncios de link no autorizado | HECHO + recorte | P:222 exige link canónico; P:236 requiere reparación si no está autorizado. Borrado silencioso marcado. |
| `decision.service.ts:1184–1245` | Sustituye URL configurada por recurso reservado y añade enlace canónico autorizado | HECHO | P:222 y B:84–85 permiten insertar recurso de pago; conservar identidad/importe autorizado. No habilita sustituir hechos inventados. |
| `materialize-payment-link-action.ts:40`, `assembleMaterializedPaymentResponse` | Añade link y normaliza separación de párrafos | HECHO + ENTREGA TÉCNICA | P:222: transición del modelo más link en el mismo mensaje. |
| `decision.service.ts:1325–1370`, `enforceCommercialTruthV1` | Rechaza precio/duración/modalidad/promesa falsa | HECHO (validación, no transformación) | P:50/54/93–98/236. Correcto: rechazar y reparar, no corregir importe silenciosamente. |
| `decision.service.ts:1447–1535`, veto y `resolveTechnicalFallbackV1` | Tras fallo/veto conserva prosa segura o sustituye por fallo técnico fijo | HECHO + ESTILO-REGISTRO | No afirmar efectos P:222/236; la frase fija no tiene autorización textual expresa. Failsafe a revisar, no eliminar en este bloque. |
| `physical-outbound-texts.ts:29`, `physicalOutboundTexts`/`fitIntoTransport` | Conserva palabras, divide/reagrupa hasta 3 partes; pago+link juntos | ENTREGA TÉCNICA | P:17/21 pide 1–2 mensajes. El límite técnico 3 es tolerancia del transporte, no instrucción para generar 3. |
| `processInboundTurn.ts:3017/3238` y envío :3101/:3327 | Verifica hash de egress; pasa `content` intacto a proveedor | ENTREGA TÉCNICA | P:236, B:73: autorizar antes de enviar. No modifica texto. Recepción de Botpress no prueba entrega al teléfono. |
| Router y fast paths (`commercial-router`, greeting/transaction/call-handoff) | Textos deterministas en rutas sin generación, no reescriben un borrador existente | ESTILO-REGISTRO / HECHO | P:7/17/206/236: distinguir bypass de transformación. Plantillas quedan inventariadas y sin cambio. |
| `modelUnavailableFallback`, `technical-fallback.ts:48`, `customerVisibleModelFallback` (:315 workflow) | Cadenas de contingencia si no hay modelo/propuesta usable | ESTILO-REGISTRO (failsafe) | P:236 exige continuidad; no autoriza expresamente cada frase fija. Mantener y hacer observable. |
| `post-sale/service.ts:259`, `deterministicAccessBlocks` | Agrega usuario, contraseña, campus, cursos comprobados y contactos oficiales | HECHO + ENTREGA TÉCNICA + texto fijo | P:230 autoriza credenciales/correo/link; B:89–90 cursos activados. Textos decorativos/contactos adicionales exceden esa autorización expresa: pendiente. |
| `post-sale/service.ts:280`, `assemblePostSaleMessage` (:292) | Cambia StudyX→Studyx; valida sugerencia de contraseña por whitelist; agrega bloques | HECHO/marca + ESTILO-REGISTRO | P:7 identidad; P:230 sugiere cambiar contraseña sin exigir. Whitelist de redacción no es hecho: pendiente. |
| `botpress-agent/src/utils/post-sale-instructions.ts:16–27` | Contingencias postventa fijas y contrato de narrativa especial | ESTILO-REGISTRO | P:228/230/236 atribuye narrativa al modelo. No modificar prompt en este trabajo. |
| `calls/application/post-call-followup.ts:193–236` | Valida narrativa generada, autoriza egress y envía contenido | HECHO + ENTREGA TÉCNICA | P:212/228: continuar según resultado; registrar ruta separada de turnos inbound. |
| Entregas asincrónicas administradas y outbox/reconciliadores | Envía contenido persistido/verificado y reporta estado; no nuevo copy del modelo | ENTREGA TÉCNICA | P:232 y B:73/90: idempotencia/estado. No atribuir reintento físico a una nueva generación. |

## Decisión de alcance

Sólo cambia la conversión de registro. Se conservan eliminación de signos de
apertura, validación de hechos/efectos, enlaces y entrega. El resto de las
contradicciones queda explícitamente pendiente. Un test que protege texto fijo
no lo convierte en autoridad. Una evaluación de fallos puede no atribuir
causalidad sólo por el nombre de una capa.

## Evidencia

La regresión del normalizador falló antes del cambio con «Querés… contame…
tenés» convertido a «Quieres… cuéntame… tienes». La corrección conserva cada
palabra y oferta de llamada, y elimina únicamente ¿ y ¡ (P:13/15).
