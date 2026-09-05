# Seguimiento Telegram V21 — transcripción sanitizada y diagnóstico

Fecha observada: 2026-09-05, 01:08–01:11 UTC.

Esta evidencia corresponde a una conversación real de Telegram sobre el bot
STUDYX. Se eliminaron nombre, apellido, correo, teléfono e identificadores del
usuario. Los originales privados permanecen fuera de Git en
`.eval/codex-20260904/telegram-review/current-test.private.json`.

## Identidad de la ruta ejecutada

Las doce decisiones remotas registraron:

- `reason_code=AGENT_A_PLANNERLESS_V2` en la ruta normal;
- `prompt_version=studyx-agent-a-brain-v21`;
- `model_provider=deepseek-direct`;
- `model_name=deepseek-v4-flash`.

Por lo tanto, Telegram sí estaba ejecutando V21. El resultado defectuoso no fue
una conversación contra un bundle anterior.

## Transcripción sanitizada

| Turno | Usuario | Resultado observable |
|---:|---|---|
| 1 | “Buenas tardes” | Respuesta de bienvenida. No ofreció llamada. |
| 2 | “Hola” | Continuó la apertura sin ofrecer llamada. |
| 3 | “Info” | Presentó información general. |
| 4 | “Quiero pagar el curso” | Preguntó qué curso, pero enumeró sólo tres opciones. |
| 5 | “Ya te había dicho, está en el chat” | Volvió a pedir el curso. |
| 6 | “Ninguno, el de fotografía” | Afirmó incorrectamente que fotografía no estaba disponible, aunque el catálogo contenía dos cursos pertinentes. |
| 7 | Selección de Aires Acondicionados | Persistió `aires_acondicionados`. |
| 8 | “Un pago de 360” | El texto dijo que se había seleccionado pago único, pero el estado siguió con `selected_payment_plan=null`. |
| 9 | “Sí, quiero el link de pago” | No podía autorizar el link porque faltaban plan e intake; pidió nombre y apellido. |
| 10 | “[apellido], [nombre] es mi nombre, ya lo sabés” | Pidió el correo, pero el nombre quedó `null` en el contacto. |
| 11 | “[correo informado]” | Guardó el correo y volvió a pedir nombre y apellido. |
| 12 | “[reclamo por la repetición]” | El modelo afirmó que ya conocía el nombre y que faltaba el correo, contradiciendo el estado. La reparación repitió la contradicción; el guard rechazó el texto y no hubo outbound. |

El workflow produjo doce ejecuciones, once respuestas aceptadas por Botpress y
un turno final silencioso con `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`.

## Estado durable al finalizar

- Curso: `aires_acondicionados`.
- Plan de pago: `null`.
- Etapa: `course_selected`.
- Nombre: `null`.
- Correo y teléfono declarado: presentes, con valores eliminados de esta evidencia.
- Preferencia de llamada: `chat`.
- Oferta de llamada: `declined`, heredada de la misma identidad de prueba.

La falta de oferta de llamada en esta conversación tiene una causa adicional al
texto del modelo: se reutilizó el mismo contacto de pruebas, cuya memoria ya
registraba que había elegido chat y rechazado la llamada. El contrato vigente
exige no insistir después de un rechazo. Una comprobación de la primera oferta
requiere una identidad nueva o un reseteo explícito de ese contacto; no se borró
memoria de producción durante el diagnóstico.

## Causas confirmadas

1. El clasificador sí eligió `select_payment_plan` para “un pago de 360”, pero
   la propuesta no trajo `payment_plan`. El binder no reconocía esa forma
   coloquial y dejó el plan en `null`; sin plan canónico el link no podía
   materializarse.
2. El extractor de identidad cortaba el mensaje en la coma y evaluaba sólo el
   apellido. No reconocía la forma contextual “apellido, nombre es mi nombre”,
   por lo que el contacto permaneció sin nombre.
3. El resolver de catálogo veía “ninguno” antes de interpretar el reemplazo
   positivo “el de fotografía”. Devolvía `no_catalog_intent` en vez de los dos
   candidatos de fotografía.
4. El silencio final fue consecuencia del estado incorrecto: el modelo y la
   reparación afirmaron datos incompatibles con la base y el guard los rechazó.

## Correcciones recuperadas

El commit `ca66dfb` incorpora el hotfix preservado por Claude en
`wip/pre-agent-loop-lexical-hardening`:

- reconoce “un pago de 360” como `one_time`;
- reconoce un reemplazo de curso después de “ninguno” y devuelve los candidatos
  canónicos de fotografía;
- extrae de forma conservadora nombre y apellido en la forma invertida cuando el
  mensaje anterior pidió ambos campos.

Las cuatro suites focales pasan 257/257 en la rama actual. El hotfix todavía
necesita el gate integral y la publicación coordinada con el resto del estado de
la rama antes de considerarse activo en producción.

## Presupuesto reconciliado

La conversación real agregó 16 llamadas de modelo por USD 0,028110864. El smoke
posterior de function calling agregó USD 0,008505640. El acumulado reconstruido
es USD 1,085364112 frente a un tope autorizado de USD 1,08. No se habilitan más
llamadas pagas ni otro canario hasta recibir una nueva autorización explícita.
