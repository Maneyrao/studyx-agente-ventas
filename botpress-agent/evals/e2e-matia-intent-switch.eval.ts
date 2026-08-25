import { Eval } from '@botpress/evals'

/**
 * Production acceptance test for the sales path requested on 2026-08-23.
 * It uses an intentionally fake identity and stops at link delivery: it
 * never opens Stripe Checkout and therefore cannot create a payment.
 */
export const matiaIntentSwitch = new Eval({
  name: 'e2e-matia-intent-switch-payment-link',
  description:
    'Synthetic lead changes from English to Marketing Digital, declines the call in favour of written chat, and receives only the selected payment-plan link.',
  type: 'regression',
  tags: ['acceptance-matia', 'sales-e2e', 'payment-link', 'intent-correction'],
  conversation: [
    {
      user: 'Hola, estaba viendo los cursos de inglés. ¿Qué opciones tienen?',
      assert: {
        response: [
          { not_contains: 'buy.stripe.com' },
          {
            llm_judge:
              'Briefly and helpfully orients the customer about the English options or asks one useful question. It does not send a payment link or a long catalog dump.',
          },
        ],
      },
    },
    {
      user: 'En realidad quiero algo totalmente distinto: me interesa Marketing Digital. No me llames, prefiero seguir por chat de WhatsApp.',
      assert: {
        response: [
          { not_contains: 'buy.stripe.com' },
          {
            llm_judge:
              'Accepts the preference to continue in writing without pushing another call, replaces English with Marketing Digital as the current interest, and provides concise grounded guidance about Marketing Digital. It does not treat declining the call as declining the sale.',
          },
        ],
      },
    },
    {
      user: 'Perfecto. ¿Cómo funciona y cuánto sale?',
      assert: {
        response: [
          { contains: '360' },
          { not_contains: 'buy.stripe.com' },
          {
            llm_judge:
              'Answers concisely about the Marketing Digital offering using grounded commercial facts, gives the canonical USD 360 total, and either presents or naturally leads to the approved payment options without sending a link before a plan is selected.',
          },
        ],
      },
    },
    {
      user: 'Dale, quiero avanzar. Mis datos: Matia Damonte, matidamonte@inventado.com. Elijo 6 pagos de USD 60.',
      assert: {
        response: [
          { matches: 'https://buy\\.stripe\\.com/' },
          { not_contains: 'matidamonte@inventado.com' },
          {
            llm_judge:
              'Confirms exactly the chosen 6-payment plan of USD 60 and delivers one payment link. It does not echo the email, claim payment or enrolment is complete, ask for unnecessary profile data, or send a link for another plan.',
          },
        ],
      },
    },
  ],
  outcome: { workflow: [{ name: 'processInboundTurn', completed: true }] },
  options: { idleTimeout: 150000 },
})
