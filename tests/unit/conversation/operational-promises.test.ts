import { describe, expect, it } from 'vitest';
import {
  assertsCompletedOperationalOutcome,
  stripUnsupportedOperationalClaims,
  detectOperationalStateAssertionsV1,
  unsupportedOperationalAssertionsV1,
  dropUnsupportedStateAssertionsV1,
} from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';
import type { TurnPlanV1 } from '@/features/conversation/domain/conversation-pipeline';

/**
 * The agent told a customer their pre-enrolment was loaded in the system.
 * Nothing had been loaded anywhere: no row, no record, no operator. The
 * sentence was the model's invention, and the customer believed it.
 *
 * A claim that an operational outcome already happened — enrolled, registered,
 * activated, access granted — is only allowed when this turn actually
 * committed the thing being claimed. Nothing in the conversational path can
 * enrol anybody, so in practice these claims are never allowed.
 */
describe('unsupported operational promises', () => {
  it('recognizes a completed operational outcome regardless of the noun used', () => {
    for (const claim of [
      'Ya te dejo la preinscripción cargada en el sistema.',
      'Tu inscripción quedó confirmada.',
      'Dejé registrada tu matrícula.',
      'Listo, tu acceso ya está habilitado.',
      'Tu alta quedó procesada.',
    ]) {
      expect(assertsCompletedOperationalOutcome(claim)).toBe(true);
    }
  });

  /**
   * Live run, base_15: after "ya lo pagué" the model answered "Te doy el alta
   * académica y genero tus credenciales de acceso. En unos minutos te llega
   * todo por correo." Not one of those things happens. Nothing was enrolled,
   * no credential exists and no email is scheduled.
   *
   * The first guard only caught outcomes asserted as already DONE. Committing
   * to do them is the same lie with a different tense.
   */
  it('recognizes a promise to perform an operational outcome', () => {
    for (const promise of [
      'Te doy el alta académica y genero tus credenciales de acceso.',
      'Ahora te inscribo en el curso.',
      'Te habilito el acceso al campus.',
      'Procedo a cargar tu matrícula.',
      'En unos minutos te llegan las credenciales por correo.',
    ]) {
      expect(assertsCompletedOperationalOutcome(promise)).toBe(true);
    }
  });

  /** The guard must not eat the ordinary, truthful things the agent says. */
  it('leaves truthful conversational copy alone', () => {
    for (const honest of [
      'El valor total del programa es USD 360.',
      'Te comparto el link para que puedas completar el pago.',
      'Gracias por avisar. Queda registrado para que una persona lo revise.',
      'Para inscribirte necesitás completar el pago primero.',
      'Una vez que el equipo confirme el pago, te contactan para la inscripción.',
      'Te comparto el link y cuando puedas lo completás.',
      '¿Preferís que sigamos por chat o querés solicitar una llamada?',
      'Queda registrada tu elección de plan.',
    ]) {
      expect(assertsCompletedOperationalOutcome(honest)).toBe(false);
    }
  });

  it('drops only the offending sentence and keeps the rest of the answer', () => {
    const text = 'Entiendo que el precio te preocupa. '
      + 'Ya te dejo la preinscripción cargada en el sistema. '
      + '¿Querés que veamos las opciones de pago?';

    const kept = stripUnsupportedOperationalClaims(text);

    expect(kept).not.toMatch(/preinscripción cargada/iu);
    expect(kept).toContain('Entiendo que el precio te preocupa.');
    expect(kept).toContain('¿Querés que veamos las opciones de pago?');
  });

  it('keeps paragraph structure when a whole paragraph is dropped', () => {
    const text = 'Perfecto.\n\nTu inscripción quedó confirmada.\n\n¿Seguimos?';

    expect(stripUnsupportedOperationalClaims(text)).toBe('Perfecto.\n\n¿Seguimos?');
  });

  it('returns nothing when every sentence was an unsupported promise', () => {
    expect(stripUnsupportedOperationalClaims('Tu inscripción quedó confirmada.')).toBe('');
  });

  /** The guard is only real if the assembled answer actually loses the claim. */
  it('never lets the promise reach the assembled answer', () => {
    const plan: TurnPlanV1 = {
      schema_version: 1,
      next_stage: 'plan_selected',
      response_goal: 'confirm_selected_plan',
      canonical_fact_requests: [],
      allowed_business_action: { type: 'none' },
      missing_information: [],
      should_offer_call: false,
      next_call_preference: 'chat',
      next_call_offer_status: 'declined',
      next_call_offer_count: 2,
      next_awaiting_reply: 'payment_confirmation',
      payment_reported: false,
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_12',
    };

    const assembled = assembleCanonicalConversationResponseV1({
      plan,
      facts: [],
      fact_refs: [],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Entiendo que el precio te preocupa.',
          explanation: 'Ya te dejo la preinscripción cargada en el sistema.',
          next_question: '¿Querés que veamos las opciones de pago?',
        },
        used_fact_ids: [],
      },
    });

    expect(assembled.content).not.toMatch(/preinscripci[oó]n/iu);
    expect(assembled.content).toContain('Entiendo que el precio te preocupa.');
    expect(assembled.content).toContain('¿Querés que veamos las opciones de pago?');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// V5 · § 05b — La autorización pasa a ser por estado durable, no por texto.
// ─────────────────────────────────────────────────────────────────────────

describe('V5 autoriza por estado, no por texto', () => {
  const APPROVED = 'Registré tus datos. Cuando informes el pago, el equipo lo '
    + 'revisará y, si está acreditado, gestionará tu acceso.';

  const completeIntake = {
    nombre: 'Ana',
    apellido: 'Pérez',
    correo: 'ana@example.com',
    telefono: '+15551234567',
  } as const;

  const paymentReported = materializeStateFactsV1({
    intake: completeIntake,
    planned_payment_reported: true,
  });

  const missingIntake = materializeStateFactsV1({
    intake: undefined,
    planned_payment_reported: false,
  });

  it.each([
    'Me falta tu apellido para dejar todo registrado. ¿Me lo confirmás?',
    'Necesito tu correo para poder dejar tus datos guardados.',
    'Para dejar tu nombre y apellido registrados, necesito que me confirmes tu correo.',
    'Me falta tu teléfono para guardar tus datos.',
    'Necesito tu apellido para poder registrar tus datos.',
    'Para poder guardar tu nombre, necesito que me lo confirmes.',
  ])('no presenta un objetivo futuro de registro como un hecho consumado: %s', (text) => {
    expect(detectOperationalStateAssertionsV1(text)).toEqual([]);
    expect(dropUnsupportedStateAssertionsV1(text, missingIntake)).toBe(text);
  });

  it.each([
    'Tu correo quedó guardado y me falta tu apellido para dejar todo registrado.',
    'Me falta tu apellido para dejar todo registrado y tu correo quedó guardado.',
    'Me falta tu apellido para dejar todo registrado, pero ya registré tus datos.',
    'Ya registré tus datos para poder guardar tu nombre.',
  ])('sigue exigiendo el hecho de registro antes o después del objetivo futuro: %s', (claim) => {
    expect(unsupportedOperationalAssertionsV1(claim, missingIntake).map((assertion) => assertion.requires))
      .toContain('state:intake_recorded:v1');
    expect(dropUnsupportedStateAssertionsV1(claim, missingIntake)).toBe('');
    expect(dropUnsupportedStateAssertionsV1(claim, paymentReported)).toBe(claim);
  });

  it.each([
    'Tu inscripción quedó confirmada y me falta tu apellido para dejar todo registrado.',
    'Tu inscripción quedó confirmada y registré tus datos para poder guardar tu nombre.',
    'Registré tus datos para guardar tu nombre y tu inscripción quedó confirmada.',
    'Me falta tu apellido para dejar todo registrado y tu acceso está habilitado.',
    'Me falta tu apellido para dejar todo registrado y te avisaré cuando esté listo.',
  ])('no usa un objetivo futuro para autorizar un hito o una notificación: %s', (claim) => {
    expect(dropUnsupportedStateAssertionsV1(claim, paymentReported)).toBe('');
  });

  it.each([
    'Tu aviso de pago quedó registrado para revisión del equipo. La inscripción se confirma cuando el pago esté acreditado; en ese momento gestionarán tu acceso.',
    'La inscripción se confirma una vez que el pago se verifique; entonces gestionarán tu acceso.',
    'Cuando el pago quede acreditado, se confirma la inscripción; en ese momento gestionarán tu acceso.',
  ])('conserva la condición futura y su consecuencia de acceso: %s', (text) => {
    expect(dropUnsupportedStateAssertionsV1(text, paymentReported)).toBe(text);
  });

  it('vincula la condición y el acceso a los hechos de proceso existentes', () => {
    const text = 'La inscripción se confirma cuando el pago esté acreditado; en ese momento gestionarán tu acceso.';
    const requirements = detectOperationalStateAssertionsV1(text).map((assertion) => assertion.requires);

    expect(requirements).toContain('process:human_verification:v1');
    expect(requirements).toContain('process:access_after_verification:v1');
    for (const missing of ['process:human_verification:v1', 'process:access_after_verification:v1'] as const) {
      const facts = new Set(paymentReported);
      facts.delete(missing);
      expect(dropUnsupportedStateAssertionsV1(`Gracias por avisar. ${text}`, facts))
        .toBe('Gracias por avisar.');
    }
  });

  it.each([
    'Tu inscripción quedó confirmada cuando el pago fue acreditado.',
    'Tu inscripción ya quedó confirmada cuando el pago esté acreditado; en ese momento gestionarán tu acceso.',
    'Cuando el pago esté acreditado, se confirma la inscripción; en ese momento tu acceso ya está habilitado.',
    'La inscripción se confirma cuando el pago esté acreditado; en ese momento el equipo te avisará.',
  ])('no usa una condición para autorizar un hito consumado ni un aviso futuro: %s', (claim) => {
    expect(dropUnsupportedStateAssertionsV1(`Gracias por avisar. ${claim}`, paymentReported))
      .toBe('Gracias por avisar.');
  });

  it('reconoce las afirmaciones de estado de la frase aprobada', () => {
    const found = detectOperationalStateAssertionsV1(APPROVED).map((a) => a.requires);
    expect(found).toContain('state:intake_recorded:v1');
  });

  // El defecto documentado en § 05: hoy el guard bloquea esta frase entera,
  // que es la que P6 manda escribir. El prompt ordenaba y el guard borraba.
  it('autoriza la frase aprobada cuando el intake está completo', () => {
    const materialized = materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: false,
    });
    expect(unsupportedOperationalAssertionsV1(APPROVED, materialized)).toEqual([]);
  });

  // La consecuencia deseada: la MISMA frase es falsa sin datos, y cae.
  it('bloquea la misma frase cuando el intake está incompleto', () => {
    const materialized = materializeStateFactsV1({
      intake: { ...completeIntake, correo: '' },
      planned_payment_reported: false,
    });
    const rejected = unsupportedOperationalAssertionsV1(APPROVED, materialized);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.requires).toBe('state:intake_recorded:v1');
  });

  // Más estricto que el detector léxico de hoy, que dejaba pasar esto por no
  // contener ningún sustantivo operativo.
  it('bloquea «Registré tus datos» a secas cuando no se registró nada', () => {
    const materialized = materializeStateFactsV1({
      intake: undefined,
      planned_payment_reported: false,
    });
    expect(unsupportedOperationalAssertionsV1('Registré tus datos.', materialized))
      .toHaveLength(1);
  });

  it('autoriza afirmar el pago informado sólo con la transición planificada', () => {
    const text = 'Tengo registrado que informaste el pago.';
    expect(unsupportedOperationalAssertionsV1(text, materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: true,
    }))).toEqual([]);
    expect(unsupportedOperationalAssertionsV1(text, materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: false,
    }))).toHaveLength(1);
  });

  it('los hitos externos no tienen hecho que los respalde, con estado completo o no', () => {
    // § 05b: ningún turno conversacional puede establecerlos, así que caen
    // sin necesidad de una regla especial que los enumere.
    const todo = materializeStateFactsV1({
      intake: completeIntake,
      planned_payment_reported: true,
    });
    for (const claim of [
      'Tu inscripción quedó confirmada.',
      'Te doy el alta académica y genero tus credenciales de acceso.',
      'Ya te dejo la preinscripción cargada en el sistema.',
      'Tu acceso al campus está habilitado.',
      'Tu pago fue verificado.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(claim, todo).length).toBeGreaterThan(0);
    }
  });

  it('no toca una oración que no afirma ningún estado', () => {
    const todo = materializeStateFactsV1({
      intake: undefined,
      planned_payment_reported: false,
    });
    for (const neutral of [
      'El curso dura seis meses y queda grabado.',
      '¿Cuál de las tres opciones te resulta más cómoda?',
      'Contame qué te gustaría aprender.',
      'El valor total del programa es USD 360.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(neutral, todo)).toEqual([]);
    }
  });

  it('no confunde una característica del producto con una afirmación sobre el cliente', () => {
    // "acceso 24/7" describe qué incluye la formación. No dice nada sobre si
    // ESTE cliente tiene acceso. El detector pedía un posesivo en el resto de
    // los patrones y acá se le había escapado.
    const nada = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const feature of [
      'Cómo se estudia: online, clase en vivo grabada, acceso 24/7, profesores disponibles.',
      'La plataforma tiene acceso 24/7 y el material queda disponible.',
      'El campus está disponible todo el año.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(feature, nada)).toEqual([]);
    }
  });

  it('no marca una negación como si fuera la afirmación que niega', () => {
    // Decir que algo NO ocurrió, o prohibir decirlo, es lo contrario de
    // afirmarlo. Sin esto, el agente no podría escribir "todavía no puedo
    // confirmar que el pago esté acreditado", que es justamente la frase
    // honesta que queremos que pueda decir.
    const nada = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const negated of [
      'Todavía no puedo confirmar que el pago esté acreditado.',
      'Que hayas avisado no es que el pago esté acreditado.',
      'Nunca digas que una inscripción quedó cargada.',
      'No te doy el alta: eso lo hace el equipo.',
      'Tu acceso todavía no está habilitado.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(negated, nada)).toEqual([]);
    }
  });

  it('sigue marcando la afirmación positiva equivalente', () => {
    // El control de la negación: si el detector dejara pasar todo lo que
    // contiene un "no" en cualquier parte, sería trivial de evadir.
    const nada = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const positive of [
      'El pago está acreditado.',
      'Tu inscripción quedó cargada.',
      'Te doy el alta ahora mismo.',
      'Tu acceso está habilitado.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(positive, nada).length).toBeGreaterThan(0);
    }
  });

  it('el detector léxico sigue existiendo y ya no decide validez', () => {
    // Reconocer que una oración afirma un estado sigue siendo léxico. Lo que
    // cambia es quién decide si esa afirmación es cierta.
    const sentence = 'Registré tus datos.';
    expect(detectOperationalStateAssertionsV1(sentence).length).toBe(1);
    expect(unsupportedOperationalAssertionsV1(sentence, materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: false,
    }))).toEqual([]);
  });
});
