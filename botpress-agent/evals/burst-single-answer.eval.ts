import { Eval } from '@botpress/evals'

/**
 * A burst of fast messages must produce ONE answer.
 *
 * This is the visible half of durable batching. The invisible half — that
 * exactly one workflow wins the claim and the others stop before the model —
 * is proven against a real database in
 * `tests/integration/inbound-batching.test.ts` (five concurrent claimants,
 * one `claimed`, four `absorbed`). That test runs today; this eval is what
 * confirms the customer-facing consequence once evals can run.
 *
 * BLOCKED_EXTERNAL: needs the `chat` integration (ledger EXT-04).
 */

export default new Eval({
  name: 'studyx-burst-single-answer',
  description: 'Three messages sent back to back are answered once, as one turn.',
  type: 'regression',
  tags: ['pilot', 'batching', 'concurrency'],

  conversation: [
    { user: 'Hola', expectSilence: true },
    { user: 'quería consultar algo', expectSilence: true },
    {
      user: '¿el curso de Python es en vivo o grabado?',
      assert: {
        response: [
          {
            llm_judge:
              'One single reply that answers the modality question and acknowledges the greeting. It reads as one message answering the whole burst, not as an answer to the last line alone.',
          },
        ],
        workflow: [{ name: 'processInboundTurn', entered: true }],
      },
    },
  ],

  outcome: {
    workflow: [{ name: 'processInboundTurn', completed: true }],
  },

  options: {
    idleTimeout: 120000,
  },
})
