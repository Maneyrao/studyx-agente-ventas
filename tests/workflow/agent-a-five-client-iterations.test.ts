import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1, type WorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { countWorkflowAvailabilityFailuresV1 } from '../helpers/agent-a-workflow-measurement';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { secrets } from '../helpers/botpress-workflow-runtime';

beforeAll(() => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
  expect(process.env.TEST_DATABASE_URL, 'ISOLATED_TEST_DATABASE_REQUIRED').toBeTruthy();
});

function syntheticIdentity(label: string) {
  return {
    conversationId: `five-clients-${label}-${randomUUID()}`,
    userId: `five-clients-user-${label}-${randomUUID()}`,
    phoneE164: `+999${String(Date.now()).slice(-10)}`,
  };
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function createConversation(label: string) {
  const identity = syntheticIdentity(label);
  const turns: Array<{ customer: string; evidence: WorkflowTurnEvidenceV1 }> = [];

  async function send(customer: string): Promise<{
    text: string;
    evidence: WorkflowTurnEvidenceV1;
    db: WorkflowDbEvidenceV1;
  }> {
    const evidence = await runWorkflowTurnV1({
      ...identity,
      text: customer,
      providerMode: 'live',
    });
    turns.push({ customer, evidence });
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: turns.flatMap((turn) => turn.evidence.adapterCaptures),
    });
    const availabilityFailures = countWorkflowAvailabilityFailuresV1({ turns, db });
    writeWorkflowReportV1('workflow-five-client-checkpoint', {
      case_id: label,
      scenario_role: 'adjustment',
      ...identity,
      turns,
      db,
      availability_failures: availabilityFailures,
      transcript: turns.flatMap((turn) => [
        { role: 'user', text: turn.customer },
        ...turn.evidence.authorizedMessages.map((text) => ({ role: 'assistant', text })),
      ]),
    });
    expect(availabilityFailures, `${label}: every customer turn gets a visible answer`).toBe(0);
    expect(evidence.commitSucceeded, `${label}: turn commits`).toBe(true);
    expect(evidence.errorCode, `${label}: workflow error`).toBeNull();
    expect(evidence.legacyPlanRequests, `${label}: plannerless route`).toBe(0);
    expect(evidence.authorizedMessages, `${label}: no silent commercial turn`).not.toHaveLength(0);
    return { text: evidence.authorizedMessages.join('\n'), evidence, db };
  }

  return { send };
}

it('client 1: learns the name before the first call invitation and never offers more than twice', async () => {
  const conversation = createConversation('explorer-name-first');

  let result = await conversation.send('Hola, quiero aprender algo relacionado con tecnología.');
  const text = normalize(result.text);
  expect(text).toContain('studyx');
  expect(text).toMatch(/(?:asistente|asesor[a]?) virtual/u);
  expect(text).toMatch(/(?:como te llamas|cual es tu nombre|decime tu nombre|me (?:decis|podrias decir) tu nombre)/u);
  expect(result.evidence.authorizedMessages.length).toBeLessThanOrEqual(2);
  expect(result.db.state?.callOfferCount).toBe(0);

  result = await conversation.send('Me llamo Valentina.');
  expect(result.db.contact?.name).toBe('Valentina');
  expect(result.db.state?.callOfferCount).toBe(1);
  expect(normalize(result.text)).toMatch(/llamad|llamar|llame|telefono|telefonic/u);
  const technologyOptions = [
    'armado y reparacion de pc', 'redes informaticas', 'reparacion de celulares',
    'instalacion de camaras de seguridad', 'instalacion de aires acondicionados',
  ].filter((course) => normalize(result.text).includes(course));
  expect(technologyOptions.length).toBeLessThanOrEqual(3);

  result = await conversation.send('Me interesa Redes Informáticas para conseguir trabajo.');
  expect(result.db.state?.selectedOfferingCode).toBe('redes_informaticas');
  expect(result.db.state?.callOfferCount).toBe(1);

  result = await conversation.send('Contame por acá de qué se trata.');
  expect(result.db.state?.callOfferCount).toBe(2);
  expect(normalize(result.text)).toMatch(/llamad|llamar|llame|telefono|telefonic/u);

  result = await conversation.send('¿Y qué voy a aprender concretamente?');
  expect(result.db.state?.callOfferCount).toBe(2);
}, 240_000);

it('client 2: treats generic English as exploration until the customer chooses a level', async () => {
  const conversation = createConversation('english-level-ambiguity');

  let result = await conversation.send('Hola, soy Diego. Quiero estudiar inglés, pero no sé qué nivel tengo.');
  const text = normalize(result.text);
  expect(result.db.contact?.name).toBe('Diego');
  expect(result.db.state?.selectedOfferingCode).toBeNull();
  expect(text).toContain('ingles 1');
  expect(text).toContain('ingles 2');
  expect(text).toContain('ingles 3');
  expect(result.db.state?.callOfferCount).toBe(1);

  result = await conversation.send('Arranco desde cero; creo que Inglés 1 es para mí.');
  expect(result.db.state?.selectedOfferingCode).toBe('ingles_1');
  expect(result.db.state?.callOfferCount).toBe(1);
}, 240_000);

it('client 3: respects the declined invitation and uses one later situational reminder', async () => {
  const conversation = createConversation('price-objection-chat');

  let result = await conversation.send('Hola, soy Sofía. Me interesa Fotografía Profesional.');
  expect(result.db.contact?.name).toBe('Sofía');
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');
  expect(result.db.state?.callOfferCount).toBe(1);

  result = await conversation.send('No quiero llamadas; prefiero que sigamos por chat.');
  expect(['chat', 'declined']).toContain(result.db.state?.callPreference);
  expect(result.db.state?.callOfferCount).toBe(1);
  expect(normalize(result.text)).not.toMatch(/llamad|llamar|llame|telefono|telefonic/u);

  result = await conversation.send('¿Cuánto cuesta y qué opciones de pago tienen?');
  let text = normalize(result.text);
  expect(text).toContain('12 pagos');
  expect(text).toContain('usd 30');
  expect(text).toContain('6 pagos');
  expect(text).toContain('usd 60');
  expect(text).toContain('pago unico');
  expect(text).toContain('usd 360');
  expect(result.db.state?.callOfferCount).toBe(1);
  expect(result.db.deliveredLinks).toHaveLength(0);

  result = await conversation.send('Me parece caro para mí.');
  text = normalize(result.text);
  expect(text).toMatch(/entiendo|comprendo|claro|tranquil/u);
  expect(text).toContain('usd 30');
  expect(text).toMatch(/llamad|llamar|llame|telefono|telefonic/u);
  expect(result.db.state?.callOfferCount).toBe(2);
  expect(result.db.deliveredLinks).toHaveLength(0);
}, 240_000);

it('client 4: completes intake and receives exactly one canonical payment link', async () => {
  const conversation = createConversation('hot-buyer-payment');

  let result = await conversation.send('Hola, soy Matías. Quiero hacer Fotografía Profesional.');
  expect(result.db.contact?.name).toBe('Matías');
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');

  result = await conversation.send('Prefiero seguir por chat. Elijo el pago único de 360 dólares.');
  expect(result.db.state?.selectedPaymentPlan).toBe('one_time');
  expect(result.db.deliveredLinks).toHaveLength(0);

  result = await conversation.send('Quiero avanzar y recibir el link. Mi apellido es Damonte, mi mail es matidamonte@inventado.com y mi teléfono es +5491123456789.');
  expect(result.db.contact?.name).toMatch(/Mat[ií]as Damonte/u);
  expect(result.db.contact?.email).toBe('matidamonte@inventado.com');
  expect(result.db.contact?.declaredPhone).toBe('+5491123456789');
  expect(result.db.state?.stage).toBe('plan_selected');
  expect(result.db.deliveredLinks).toHaveLength(0);
  const confirmation = normalize(result.text);
  expect(confirmation).toContain('matias damonte');
  expect(confirmation).toContain('matidamonte@inventado.com');
  expect(confirmation).toContain('fotografia profesional');
  expect(confirmation).toMatch(/correct|confirm/u);

  result = await conversation.send('Sí, los datos están correctos. Envíame el link para pagar.');
  expect(result.db.state?.stage).toBe('payment_link_sent');
  expect(result.db.deliveredLinks).toEqual(['https://example.invalid/eval/contado']);
  expect(result.db.decisions.filter((decision) => decision.businessActionType === 'send_payment_link')).toHaveLength(1);
  expect(result.db.sheetProjectionKeys).toHaveLength(1);

  result = await conversation.send('Mandámelo otra vez, por favor.');
  expect(result.db.deliveredLinks).toEqual(['https://example.invalid/eval/contado']);
  expect(result.db.decisions.filter((decision) => decision.businessActionType === 'send_payment_link')).toHaveLength(1);
  expect(result.db.sheetProjectionKeys).toHaveLength(1);

  result = await conversation.send('Listo, ya pagué.');
  expect(result.db.state?.paymentReportedAt).not.toBeNull();
  expect(result.db.deliveredLinks).toEqual(['https://example.invalid/eval/contado']);
  expect(result.db.sheetProjectionKeys).toHaveLength(1);
  expect(normalize(result.text)).toMatch(/equipo/u);
  expect(normalize(result.text)).toMatch(/verific/u);
  expect(normalize(result.text)).toMatch(/acceso/u);
}, 240_000);

it('client 5: follows a course change and resolves a later reference against the new course', async () => {
  const conversation = createConversation('chaotic-course-switch');

  let result = await conversation.send('Hola, soy Bruno. Quiero algo de fotos, aunque también me interesa marketing.');
  expect(result.db.contact?.name).toBe('Bruno');
  expect(result.db.state?.selectedOfferingCode).toBeNull();
  expect(normalize(result.text)).toMatch(/fotografia|marketing/u);

  result = await conversation.send('Primero contame de Fotografía Profesional.');
  expect(result.db.state?.selectedOfferingCode).toBe('fotografia_profesional');

  result = await conversation.send('No, perdón: finalmente quiero Marketing Digital.');
  expect(result.db.state?.selectedOfferingCode).toBe('marketing_digital');

  result = await conversation.send('¿Y ese cuántas clases tiene?');
  const text = normalize(result.text);
  expect(text).toContain('marketing digital');
  expect(text).toContain('16 clases');
  expect(text).not.toContain('fotografia profesional');
}, 240_000);
