// Evaluation artifact only. No generation, delivery, database, or product changes.
// The deliberately dynamic historical artifact shapes are retained losslessly.
import { it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { parseAgentATurnProposalV1 } from '../../botpress-agent/src/lib/conversation/agent-a-brain';
import { resolveAgentAPlannerlessProposalV2 } from '../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { prepareAgentTurnV2 } from '../../src/features/conversation/application/prepare-agent-turn-v2';
import { canonicalTruthSetFromOfferingsV1, enforceCommercialTruthV1 } from '../../src/features/orchestration/domain/commercial-truth-guard';
import { physicalOutboundTexts } from '../../src/features/orchestration/domain/physical-outbound-texts';
import { assemblePostSaleMessage } from '../../src/features/fulfillment/post-sale/service';
import { postSaleAccessTestConfig } from '../../tests/helpers/post-sale-config';
import { technicalFallback, validationExhaustedNotice, modelUnavailableFallback } from '../../botpress-agent/src/utils/decision-policy';
import { matchCallHandoffFastPath } from '../../botpress-agent/src/utils/call-handoff-fast-path';
import { extractAuthorizedContextV1, extractModelAttemptsV1 } from './runner-support';

vi.mock('../../src/lib/db/orchestrator', () => ({
  sql: () => { throw new Error('OFFLINE_REPLAY_DATABASE_FORBIDDEN'); },
}));

const root = process.cwd();
const output = path.join(root, 'docs/reports/evidence/2026-10-31-four-priority-replay');
const indexPath = process.env.OFFLINE_REPLAY_INDEX ?? path.join(root,'docs/reports/evidence/2026-10-31-offline-replay/offline-replay-index.json');
const json = (filename) => JSON.parse(readFileSync(filename, 'utf8'));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (proposal) => [...(proposal?.response?.messages ?? []), ...(proposal?.response?.call_offer ? [proposal.response.call_offer] : [])].join('\n');
const errorInfo = (error) => ({ code: error.code ?? error.name, detail: error.detail ?? error.message,
  reasons: error.reasons ?? null, subjects: error.rejectionSubjects ?? null });
const rawText = (body) => body?.output_text ?? body?.output?.flatMap(x => x.content ?? []).map(x => x.text ?? '').join('') ?? null;
const decode = (body) => {
  const value = rawText(body);
  if (!value) return null;
  try { return JSON.parse(value.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')); }
  catch { return null; }
};

// Execute the actual private, self-contained source function. No copied or
// approximate implementation of sentence selection is used by this replay.
function sourceFunction(filename, name, dependencies = {}) {
  const source = name === 'literalConversationVariants'
    ? execFileSync('git', ['show', `06ec3e5:${filename}`], { encoding:'utf8' })
    : readFileSync(path.join(root, filename), 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`SOURCE_FUNCTION_MISSING:${name}`);
  const original = node.getText(ast);
  const compiled = ts.transpileModule(`${original}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return { run: new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies)), sha256: hash(original), filename, name };
}

const literals = sourceFunction('botpress-agent/src/workflows/processInboundTurn.ts', 'literalConversationVariants');
const complete = sourceFunction('botpress-agent/src/workflows/processInboundTurn.ts', 'completeConversationProposals');
const visibleText = sourceFunction('botpress-agent/src/workflows/processInboundTurn.ts', 'normalizedVisibleText');
const mentionsBonus = sourceFunction('botpress-agent/src/workflows/processInboundTurn.ts', 'mentionsProposedBonusOfferingV1', {
  normalizedVisibleText: visibleText.run,
});
const historicalBrainSource = execFileSync('git', ['show','d2c836a:botpress-agent/src/lib/conversation/agent-a-brain.ts'], { encoding:'utf8' });
const historicalBrainAst = ts.createSourceFile('historical.ts', historicalBrainSource, ts.ScriptTarget.Latest, true);
const historicalNormalizerSource = historicalBrainAst.statements.filter(n =>
  ts.isFunctionDeclaration(n) && n.name?.text === 'normalizeCustomerFacingSpanishV1'
  || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(historicalBrainAst) === 'NEUTRAL_SPANISH_FORMS')
).map(n => n.getText(historicalBrainAst).replace(/^export /u, '')).join('\n');
const historicalNormalize = new Function(ts.transpileModule(`${historicalNormalizerSource}\nreturn normalizeCustomerFacingSpanishV1;`, {
  compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None },
}).outputText)();
const compareText = (s) => (s ?? '').replace(/\s+/gu,' ').trim();
const canonical = (v) => v === null || typeof v !== 'object' ? v : Array.isArray(v)
  ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])]));
const equivalent = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function supplementaryRows(index) {
  return (index.supplementary_observation_attempts ?? []).flatMap(turn => turn.attempt_runtime_candidates.map(item => {
    const full = new Set(turn.exact_full_array_runtime_candidates);
    const candidates = item.runtime_candidates.flatMap(file => {
      const runtime = json(file);
      const attempts = extractModelAttemptsV1(runtime.evidence.httpExchanges);
      return attempts.flatMap((attempt,i) => equivalent(attempt,item.attempt) ? [{ file,
        attempt_index:i+1,
        report_response_real_matches_authorized_or_adapter_output: compareText(turn.observation_response_delivered)
          === compareText((runtime.evidence.adapterCaptures ?? []).map(c => c.text ?? c.content ?? c.payload?.text ?? '').filter(Boolean).join('\n')),
      }] : []);
    });
    return { ...turn, source_kind:'supplementary_partial_v6', attempt:item.attempt,
      report:turn.source_file, turn_response_real:turn.observation_response_delivered,
      backend_rejections:[], exact_full_array_candidates:candidates.filter(c => full.has(c.file)),
      individual_attempt_candidates:candidates, attempt_fingerprint_sha256:hash(canonical(item.attempt)) };
  }));
}

function historicalRelationship(runtime, row, parsed) {
  const exchanges = runtime.evidence.httpExchanges;
  const drafts = exchanges.filter(x => x.boundary === 'deepseek').map(x => decode(x.responseBody)).filter(Boolean);
  const delivered = compareText(row.turn_response_real);
  const allOriginals = drafts.map(p => compareText(text(p)));
  const allOldNormalized = drafts.map(p => compareText(historicalNormalize(text(p))));
  const result = { delivered_matches_any_original: allOriginals.includes(delivered),
    delivered_matches_any_old_normalized: allOldNormalized.includes(delivered),
    this_attempt_register_changed: historicalNormalize(text(parsed)) !== text(parsed),
    literal_slice_matching_final: null,
    committed_fixed_copy: null,
    floor_events: (runtime.evidence.workflowEvents ?? []).filter(e => [
      'studyx.turn.agent_a_precommit_conversational_floor',
      'studyx.turn.agent_a_conversational_floor_committed',
    ].includes(e.event)),
    successful_commit_reason_codes: exchanges.filter(x => x.url?.endsWith('/decision') && x.status !== null && x.status < 400)
      .map(x => x.requestBody?.decision?.reason_code).filter(Boolean),
  };
  if (delivered && !result.delivered_matches_any_old_normalized) {
    for (const candidate of literals.run(parsed)) {
      if (compareText(historicalNormalize(text(candidate))) === delivered) {
        result.literal_slice_matching_final = text(candidate);
        break;
      }
    }
    const fixedCommit = exchanges.filter(x => x.url?.endsWith('/decision') && x.status < 400)
      .find(x => compareText(x.requestBody?.decision?.response) === delivered);
    if (fixedCommit) result.committed_fixed_copy = { text: fixedCommit.requestBody.decision.response,
      reason_code: fixedCommit.requestBody.decision.reason_code,
      agent_turn_v2: fixedCommit.requestBody.agent_turn_v2 ?? null };
  }
  return result;
}

function recordedTechnicalPaths(index) {
  const runtimeFiles = readdirSync(path.join(root,'evals/golden/results/runtime')).filter(f => f.endsWith('.json'));
  const runtimes = runtimeFiles.map(f => ({ filename:path.join(root,'evals/golden/results/runtime',f), runtime:json(path.join(root,'evals/golden/results/runtime',f)) }));
  const reports = index.read_only_inputs.reports.map(filename => ({ filename, report:json(filename) }));
  return reports.flatMap(({ filename, report }) => report.cases.flatMap(item => item.turns.map(turn => {
    const selected = runtimes.filter(({ runtime }) => runtime.conversation_id?.startsWith(`golden-${item.case_id}-`)
      && runtime.customer === turn.customer
      && equivalent(extractModelAttemptsV1(runtime.evidence.httpExchanges),turn.model_attempts));
    const sourceTexts = [technicalFallback().response];
    const candidates = selected.map(({ filename, runtime }) => {
      const xs = runtime.evidence.httpExchanges;
      const claim = xs.find(x => x.url?.endsWith('/claim'))?.responseBody;
      const out = { runtime:path.relative(root,filename), trace_id:runtime.evidence.traceId,
        floor_events:(runtime.evidence.workflowEvents ?? []).filter(e => [
          'studyx.turn.agent_a_precommit_conversational_floor','studyx.turn.agent_a_conversational_floor_committed',
        ].includes(e.event)), commits:[], current_call_fast_path:null, current_fallback_candidates:[] };
      if (claim?.outcome === 'claimed') {
        out.current_call_fast_path = matchCallHandoffFastPath(claim);
        out.current_fallback_candidates = [technicalFallback(), modelUnavailableFallback(claim),
          validationExhaustedNotice('commercial_reply',{ claimed:claim,
            failure_codes:(turn.validator_rejections ?? []).map(v => typeof v === 'string' ? v : `${v.code}:${v.subject}`) })];
      }
      out.commits = xs.filter(x => x.url?.endsWith('/decision') && x.status !== null && x.status < 400)
        .map(x => ({ reason:x.requestBody?.decision?.reason_code,
          request_text:x.requestBody?.decision?.response ?? null,
          agent_turn_v2:!!x.requestBody?.agent_turn_v2,
          output_texts:(x.responseBody?.outbounds ?? (x.responseBody?.outbound ? [x.responseBody.outbound] : []))
            .map(o => o.content ?? o.text ?? null),
        }));
      return out;
    });
    return { source_file:path.relative(root,filename), case_id:item.case_id, turn_id:turn.turn_id,
      version:Number(filename.match(/(?:baseline-028f272-v|baseline-v)(\d+)/u)?.[1]),
      has_model_attempts:turn.model_attempts.length > 0, historical_delivered:turn.response_real,
      observed_current_technical_fallback_exact:compareText(turn.response_real) === compareText(sourceTexts[0]),
      candidates };
  })));
}

function candidateList(row) {
  const candidates = row.exact_full_array_candidates?.length
    ? row.exact_full_array_candidates : row.individual_attempt_candidates ?? [];
  // Prefer only candidates with exact historical delivery linkage when present.
  // Preserve all linked candidates and all contexts; never select by date.
  const linked = candidates.filter(c => c.report_response_real_matches_authorized_or_adapter_output);
  return linked.length ? linked : candidates;
}

async function replayCandidate(row, candidate) {
  const runtime = json(candidate.file);
  const exchanges = runtime.evidence.httpExchanges;
  const provider = exchanges.filter(x => x.boundary === 'deepseek')[candidate.attempt_index - 1];
  expect(equivalent(extractModelAttemptsV1(exchanges)[candidate.attempt_index - 1],row.attempt),
    `RAW_ATTEMPT_LINK_MISMATCH:${candidate.file}`).toBe(true);
  const context = extractAuthorizedContextV1(provider.requestBody);
  const raw = decode(provider.responseBody);
  const claim = exchanges.find(x => x.boundary === 'backend' && x.url.endsWith('/claim'))?.responseBody;
  const out = {
    runtime: path.relative(root, candidate.file), trace_id: runtime.evidence.traceId,
    generation_id: `${runtime.evidence.traceId}:${candidate.attempt_index}`,
    context_sha256: hash(context), provider_raw_text: rawText(provider.responseBody), raw_proposal: raw,
    original: text(raw) || null, normalized: null, plannerless_text: null,
    preparation_text: null, current_precommit_text: null, physical_parts: null,
    delivered_today: null, delivery_status: 'unverified_no_commit_or_effect_execution',
    state_basis: 'recorded_claim_effective_projection', transformations: [],
    rejections: [], repair_requested: false, effect_executed: false,
  };
  if (!raw || !context) return { ...out, outcome: 'missing_raw_proposal_or_context' };
  let parsed;
  try { parsed = parseAgentATurnProposalV1(raw, context); }
  catch (error) { return { ...out, outcome: 'parser_rejected', rejections: [errorInfo(error)] }; }
  out.normalized = text(parsed);
  out.historical_relationship = historicalRelationship(runtime, row, parsed);
  const removedBubbles = (raw.response?.messages ?? []).filter(m => /https?:\/\//iu.test(m) || /\{\{[^}]+\}\}/u.test(m));
  if (out.normalized !== out.original) {
    if (out.original?.includes('¿') || out.original?.includes('¡')) out.transformations.push({
      id: 'opening_punctuation', authority: 'P:15', contradiction: false });
    if (removedBubbles.length) out.transformations.push({ id: 'url_or_placeholder_bubble_removed',
      removed: removedBubbles, authority: 'P:222/236', contradiction: true });
    if (parsed.response.messages.includes('Perfecto, te comparto el enlace autorizado para continuar.')
      && !raw.response.messages.includes('Perfecto, te comparto el enlace autorizado para continuar.')) {
      out.transformations.push({ id: 'payment_fixed_template', authority: 'P:17/236', contradiction: true });
    }
  }
  let resolved;
  try {
    resolved = await resolveAgentAPlannerlessProposalV2({
      initial: { proposal: parsed, provider: 'deepseek', model: 'recorded', source: 'model' },
      context, repair_enabled: true,
      rejection_id: context.turn_rejection?.rejection_id ?? '00000000-0000-4000-8000-000000000001',
      semantic_rejections: 'advisory',
      observe: event => { if (event.kind === 'proposal_rejected') out.rejections.push(event.rejection); },
      repair: async (rejection) => {
        out.repair_requested = true;
        out.requested_repair = rejection;
        throw new Error('OFFLINE_REPLAY_MODEL_FORBIDDEN');
      },
    });
  } catch (error) {
    out.rejections.push(errorInfo(error));
    return { ...out, outcome: out.repair_requested ? 'repair_required_unavailable' : 'plannerless_rejected' };
  }
  const proposal = resolved.effective.proposal;
  out.plannerless_text = text(proposal);
  out.plannerless_action = proposal.proposed_action;
  out.plannerless_action_rejection = resolved.action_rejection;
  if (out.plannerless_text !== out.normalized) out.transformations.push({
    id: 'failed_repair_fact_pruning', authority: 'P:50/236;B:71', contradiction: true,
    condition: out.repair_requested ? 'after_unavailable_repair' : 'current_resolver',
  });
  if (!claim?.conversation_state_v1 || typeof claim.conversation_state_v1.payment_reported !== 'boolean'
    || !claim.call_intake_readiness || !claim.business_context?.workspace?.slug
    || !claim.sales_context || !('active_call' in claim.sales_context) || !('last_call_result' in claim.sales_context)) {
    return { ...out, outcome: 'unknown_missing_recorded_state' };
  }
  const state = new Proxy({
    ...claim.conversation_state_v1,
    workspace_id: 'workspace_id_unrecorded_identity_only',
    conversation_id: claim.batch.conversation_id, contact_id: claim.batch.contact_id,
    updated_at: 'unrecorded_effective_projection', created_at: 'unrecorded',
    payment_reported_at: claim.conversation_state_v1.payment_reported ? 'reported_at_unrecorded' : null,
  }, { get(target, key) {
    if (['human_review_requested_at', 'consecutive_technical_fallbacks', 'source_turn_id'].includes(key))
      throw new Error(`UNKNOWN_RECORDED_STATE_FIELD:${key}`);
    return target[key];
  } });
  const callFacts = new Proxy({ active_call: claim.sales_context.active_call,
    last_call_result: claim.sales_context.last_call_result }, { get(target, key) {
    if (['open_offer', 'open_retry_prompt', 'last_decline_at'].includes(key)) throw new Error(`UNKNOWN_CALL_LEDGER:${key}`);
    return target[key];
  } });
  // Profile capture executes before preparation. Use only its actual saved
  // reply from this attempt interval; never infer WhatsApp email evidence.
  const start = exchanges.indexOf(provider);
  const nextProvider = exchanges.findIndex((x, i) => i > start && x.boundary === 'deepseek');
  const interval = exchanges.slice(start + 1, nextProvider < 0 ? undefined : nextProvider);
  const profile = interval.filter(x => x.url?.endsWith('/profile')).at(-1)?.responseBody?.contact_profile_snapshot;
  const intake = profile?.values ?? claim.contact_intake;
  const readiness = profile?.call_intake_readiness ?? claim.call_intake_readiness;
  out.profile_basis = profile ? 'recorded_profile_capture_this_attempt' : 'recorded_claim';
  const facts = (claim.context?.knowledge_base ?? []).filter(x => x.offering_code).map(x => ({
    id: x.source_uri, kind: 'offering_syllabus', source: 'knowledge_base',
    offering_code: x.offering_code, value: x.content,
  }));
  const prep = async (p, conversationOnly = false) => prepareAgentTurnV2({
    turn: { id: claim.turn_id, workspace_id: 'workspace_id_unrecorded_identity_only',
      conversation_id: claim.batch.conversation_id, contact_id: claim.batch.contact_id },
    workspace_slug: claim.business_context.workspace.slug,
    current_customer_messages: claim.context.batch_messages.map(x => x.content),
    proposal: p, semantic_rejections: 'advisory', business_context: claim.business_context,
    ...(conversationOnly ? { conversation_only:true, requested_action:proposal.proposed_action } : {}),
    catalog_index: claim.catalog_index, authorized_knowledge_facts: facts,
    course_bonus_capability: claim.course_bonus_capability,
  }, {
    state_store: { load: async () => state },
    call_facts: { loadClaimedCallFacts: async () => callFacts },
    contact_intake: async () => intake, call_intake_readiness: async () => readiness,
    payment_verification: async () => claim.payment_verification,
    now: () => Date.parse(runtime.evidence.occurredAt),
  });
  const truth = (prepared) => {
    const offerings = claim.business_context.offerings.map(o => ({ ...o,
      price_type: o.price_type ?? o.price?.type, price_amount: o.price_amount ?? o.price?.amount,
      currency: o.currency ?? o.price?.currency,
      // Only fields present in the recorded projection are recoverable.
      // Extra durable delivery/metadata fields remain unknown.
      delivery: { classes: o.classes, modules: o.modules, hours_per_month: o.hours_per_month,
        modality: o.modality, certification: o.certification },
      metadata: { aliases: o.aliases, academy: o.academy },
    }));
    const canonical = canonicalTruthSetFromOfferingsV1({ offerings,
      selected_offering_code: prepared.authorized_offering_code,
      allow_workspace_payment_options: prepared.authorized_offering_code == null,
      payment_options: claim.business_context.workspace.payment_options,
    });
    const direct = prepared.decision.business_action?.type === 'offer_course_bonus'
      ? prepared.decision.business_action.bonus_offering_code : null;
    return enforceCommercialTruthV1({ content: prepared.decision.response, authorized_urls: [], canonical: {
      ...canonical,
      paid_offering_names: offerings.filter(o => o.code === prepared.authorized_offering_code).map(o => o.display_name),
      authorized_bonus_names: [
        ...(claim.course_bonus_capability?.delivered_bonus_offerings ??
          (claim.course_bonus_capability?.enabled ? [] : claim.course_bonus_capability?.bonus_offerings ?? [])),
        ...offerings.filter(o => o.code === direct),
      ].map(o => o.display_name),
      prices: [...canonical.prices, ...prepared.authorized_protected_facts.filter(f => f.kind === 'price').map(f => f.value)],
      durations: [...canonical.durations, ...prepared.authorized_protected_facts.filter(f => f.kind === 'duration').map(f => f.value)],
      payment_plans: [...(canonical.payment_plans ?? []),
        ...(prepared.decision.business_action?.type === 'send_test_payment_link'
          ? [{ installments:1, price:'USD 0.50' }] : [])],
    } });
  };
  try {
    const prepared = await prep(proposal);
    out.preparation_text = prepared.decision.response;
    out.authorized_action_in_snapshot = prepared.decision.business_action;
    out.preparation_action_rejection = prepared.action_rejection;
    const verdict = truth(prepared);
    out.commercial_truth = verdict;
    out.canonical_basis = 'recorded_flat_business_projection_missing_raw_delivery_metadata';
    if (verdict.violations.length) {
      out.rejections.push({ code: 'COMMERCIAL_TRUTH_VIOLATION', violations: verdict.violations });
      out.outcome = verdict.violations.some(v => v.code === 'LOGISTICS_NOT_CANONICAL')
        ? 'unknown_logistics_missing_raw_canonical_snapshot' : 'conditional_truth_rejected_repair_unavailable';
    } else {
      out.current_precommit_text = prepared.decision.response;
      out.physical_parts = physicalOutboundTexts({ final_response: prepared.decision.response,
        authored_messages: prepared.response_messages, enabled: true,
        force_single_message: ['send_payment_link','send_test_payment_link'].includes(prepared.decision.business_action?.type),
      });
      out.outcome = out.repair_requested ? 'repair_unavailable_conditional_safe_remainder' : 'conditional_precommit_authorized';
    }
  } catch (error) {
    out.rejections.push(errorInfo(error));
    out.outcome = error.message.startsWith('UNKNOWN_') ? 'unknown_recorded_state' : 'conditional_preparation_rejected';
  }
  // These are potential candidates, not an invented executed workflow. Record
  // only when a current boundary rejected; no historical repair is reused.
  if (out.outcome?.includes('rejected')) {
    const variants = complete.run(proposal);
    out.literal_variant_count = variants.length;
    for (const variant of variants) {
      if (text(variant) === text(proposal)) continue;
      if (mentionsBonus.run({ proposal: variant,
        messages: [...variant.response.messages, variant.response.call_offer ?? ''], context })) continue;
      try {
        const strict = await resolveAgentAPlannerlessProposalV2({
          initial: { proposal: { ...variant, proposed_action:{ type:'none' } }, provider:'recorded', model:'recorded' },
          context, repair_enabled:false, semantic_rejections:'blocking',
          rejection_id: context.turn_rejection?.rejection_id ?? '00000000-0000-4000-8000-000000000001',
          repair:async () => { throw new Error('OFFLINE_REPLAY_MODEL_FORBIDDEN'); },
        });
        const prepared = await prep(strict.effective.proposal, true);
        if (truth(prepared).violations.length === 0) {
          out.first_conditionally_valid_literal = prepared.decision.response;
          out.transformations.push({ id: 'literal_variant_available', contradiction: true,
            authority: 'P:17/236;B:71', condition: 'candidate_only_no_new_model_repair_or_commit' });
          break;
        }
      } catch { /* rejected candidate cannot be delivered */ }
    }
  }
  return out;
}

function postSale(row) {
  // Report extractor joined intro+suggestion with a newline. Preserve this
  // reconstruction limit; there is no saved provider JSON for this event.
  const split = row.attempt.response.lastIndexOf('\n');
  const narrative = split >= 0 ? { intro: row.attempt.response.slice(0, split), suggestion: row.attempt.response.slice(split + 1) }
    : { intro: row.attempt.response, suggestion: '' };
  const out = { original: row.attempt.response, narrative, basis: 'report_joined_intro_suggestion',
    reconstruction_conditional: true, rejections: [], transformations: [], delivered_today: null,
    outcome: 'post_sale_snapshot', effect_executed: false };
  // This exact synthetic source is recorded by the golden setup, not guessed
  // from the model prose. This proves the assembler, not delivery/fulfillment.
  const source = { kind: 'access_ready', enrollment_status: 'active', student_was_created: true,
    login_email: 'ana.golden@example.test', login_url: null,
    offering_name: 'Fotografía Profesional',
    bonus_offerings: [
      { code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online', position: 1 },
      { code: 'marketing_digital', display_name: 'Marketing Digital', position: 2 },
    ], verified_bonus_enrollments: [
      { offering_code: 'fotografia_celulares_tiendas_online', enrollment_status: 'active', position: 1 },
      { offering_code: 'marketing_digital', enrollment_status: 'active', position: 2 },
    ],
  };
  out.assembled = assemblePostSaleMessage(source, undefined, postSaleAccessTestConfig);
  out.transformations.push({ id: 'owner_authorized_access_template',
    authority: 'AGENTS.md post-sale owner exception 2026-11-01;B:89-90', contradiction: false });
  return out;
}

const offline = process.env.STUDYX_OFFLINE_REPLAY === '1' ? it : it.skip;
offline('replays every recorded v3–v8 attempt offline with explicit evidence boundaries', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('ALL_NETWORK_FORBIDDEN'); });
  const productDiff = execFileSync('git', ['diff','HEAD','--','src','botpress-agent'], { encoding:'utf8' });
  const index = json(indexPath);
  expect(index.attempts).toHaveLength(368);
  const corpus = [...index.attempts.map(row => ({ ...row, source_kind:'final_report' })), ...supplementaryRows(index)];
  expect(corpus).toHaveLength(427);
  const rows = [];
  for (const row of corpus) {
    const candidates = candidateList(row);
    const replayed = [];
    for (const candidate of candidates) replayed.push(await replayCandidate(row, candidate));
    rows.push({ version: row.version, source_kind:row.source_kind, case_id: row.case_id, turn_id: row.turn_id,
      attempt: row.attempt.attempt, original: row.attempt.response,
      source_file:path.relative(root,row.report),
      source_duplicate_of_version:row.source_kind === 'supplementary_partial_v6' ? 7 : null,
      historical_delivered: row.turn_response_real,
      historical_rejections: row.backend_rejections,
      all_candidate_refs:(row.exact_full_array_candidates?.length ? row.exact_full_array_candidates : row.individual_attempt_candidates ?? []).map(c => path.relative(root,c.file)),
      candidate_count: candidates.length, candidates: replayed,
      source_fingerprint: row.attempt_fingerprint_sha256,
      ...(row.turn_id === 'verified_access_event' && row.attempt.response ? { post_sale: postSale(row) } : {}),
      outcome: !row.attempt.response ? 'no_recorded_draft_provider_error'
        : replayed.length ? 'replayed_recorded_candidates' : row.turn_id === 'verified_access_event'
          ? 'post_sale_report_reconstruction' : 'missing_recorded_context',
    });
  }
  mkdirSync(output, { recursive:true });
  const report = { schema_version:1, generated_at:new Date().toISOString(),
    product_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    product_worktree_diff_sha256:hash(productDiff), product_has_uncommitted_changes:productDiff.length > 0,
    checkout_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    model_calls:0, tokens:0, deployments:0, historical_source_function:literals, current_source_function:complete,
    observation_partial_audit:index.observation_partial_audit,
    cross_version_deduplication:index.cross_version_deduplication,
    recorded_technical_paths:recordedTechnicalPaths(index),
    scope:'actual parser/resolver; prepare+truth conditional on recorded claim projection; no DB commit/effect/delivery replay',
    rows };
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(rows.filter(r => r.original && r.candidates.length > 0)).toHaveLength(415);
  expect(rows.filter(r => r.post_sale)).toHaveLength(6);
  writeFileSync(path.join(output,'replay.json'), JSON.stringify(report,null,2)+'\n');
  console.log(`OFFLINE_REPLAY_ARTIFACT:${output}/replay.json rows=${rows.length} model_calls=0`);
  fetchSpy.mockRestore();
});
