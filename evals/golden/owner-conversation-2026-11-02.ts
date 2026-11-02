/** Customer inputs transcribed from the read-only owner report. No model replies,
 * phone numbers, identities or production credentials are replayed. Multi-message
 * batches preserve their recorded order and are submitted as one synthetic turn. */
export const OWNER_REPLAY_SOURCE_V1 = {
  "file": ".local-evidence/diagnostics/2026-11-02-conversacion-dueno/informe.md",
  "sha256": "abae2670781334bfd0fa8d17379202ef892712dfbae9c096c02ef7a88a597b57",
  "recorded_backend_sha": "b839dca186cb6699bc7a44a409d84999d8304154",
  "recorded_brain": "v149",
  "recorded_prompt": "v101"
} as const;

export const OWNER_REPLAY_CUSTOMER_TURNS_V1 = [
  {
    "id": "greeting",
    "customer": "hola"
  },
  {
    "id": "repeated_greeting",
    "customer": "asd"
  },
  {
    "id": "recommendation",
    "customer": "que me podes recomendar\nvi que studyx es una gran agencia"
  },
  {
    "id": "marketing_budget",
    "customer": "me gustaría continuar estudiando con ustedes, pero tengo poco presupuesto\nquiero algo de marketing"
  },
  {
    "id": "ecommerce",
    "customer": "ecommerce me gusta\ncuánto es el total?"
  },
  {
    "id": "first_price_objection",
    "customer": "mmmmm\nme parece muy caro"
  },
  {
    "id": "price_only",
    "customer": "si\nsolo el precio me interrumpe\nes caro"
  },
  {
    "id": "repeated_price_objection",
    "customer": "me sigue pareciendo muy caro\n360 dólares\nes bastante"
  },
  {
    "id": "decline",
    "customer": "okay\nno hracias"
  },
  {
    "id": "explicit_promotion",
    "customer": "mogolico\nme tenes que ofrecer promociones"
  },
  {
    "id": "explicit_bonus",
    "customer": "si hay una promocion para qe me ofrezcas un curso gratuito si yo no quiero pagar, que me vendas\nxq no lo haces\nsi te programé para eso."
  }
] as const;
