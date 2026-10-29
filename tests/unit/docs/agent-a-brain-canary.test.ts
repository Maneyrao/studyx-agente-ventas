import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runbook = readFileSync(resolve(
  __dirname,
  '../../../docs/runbooks/agent-a-brain-canary.md',
), 'utf8');

describe('Agent A brain canary runbook', () => {
  it('documents the current DeepSeek provider and all reversible rollout flags', () => {
    expect(runbook).toContain('DEEPSEEK_API_KEY');
    expect(runbook).toContain('deepseek-v4-flash');
    for (const flag of [
      'AGENT_A_CONTEXT_SCOPING',
      'AGENT_A_STATE_ASSERTIONS',
      'AGENT_A_REPAIR_ENABLED',
      'AGENT_A_SINGLE_ROUTE',
    ]) expect(runbook).toContain(flag);
    expect(runbook).not.toContain('OPENAI_API_KEY');
    expect(runbook).not.toContain('gpt-5.6');
  });

  it('requires same SHA, independent quality and reverse-order rollback', () => {
    expect(runbook).toMatch(/mismo SHA/iu);
    expect(runbook).toContain('conversation_quality_complete=true');
    expect(runbook).toMatch(/orden inverso/iu);
    expect(runbook).toContain('AGENT_A_SINGLE_ROUTE=false');
    expect(runbook).toContain('AGENT_A_STATE_ASSERTIONS=false');
  });
});

describe('direct bonus production cutover invariants', () => {
  const path = resolve(__dirname, '../../../docs/runbooks/direct-course-bonus-v2-cutover.md');
  const cutover = () => existsSync(path) ? readFileSync(path, 'utf8') : '';

  it('orders additive backend review compatibility before dual-mode ADK and allowlisted direct canary', () => {
    const text = cutover();
    let previous = -1;
    for (const step of ['### 1. Additive backend in review', '### 2. Readiness and old ADK compatibility',
      '### 3. Publish dual-mode ADK', '### 4. Allowlisted direct canary']) {
      const current = text.indexOf(step);
      expect(current, step).toBeGreaterThan(previous);
      previous = current;
    }
    expect(text).toContain('COURSE_BONUS_FLOW_MODE=review');
    expect(text).toContain('CENTRAL_CARGA_BONUS_ENABLED=false');
    expect(text).toContain('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS');
    expect(text).toContain('COURSE_BONUS_MAX_COURSES=3');
  });

  it('requires all external-spec cases and delivery, concurrency, reconciliation and no-silence evidence', () => {
    const text = cutover();
    for (const id of ['S1','S2','S3','S4','S5','S6','S7','V1','V2','V3','V4','V5','V6','V7','V8','V9',
      'C1','C2','C3','C4','C5','C6','C7','C8']) expect(text).toMatch(new RegExp(`\\| ${id} \\|`, 'u'));
    for (const field of ['trace_id','source_turn_id','promotion_cycle_id','offer_version','outbound_message_id',
      'delivered_at','occurred_at','payment_id','retry_offering_codes','manual_case_id','recovery_id']) expect(text).toContain(field);
    expect(text).toContain('submitted_to_botpress is not confirmed delivery');
  });

  it('preserves offered accepted attached obligations and dual-mode ADK during rollback', () => {
    const rollback = cutover().split('## Rollback')[1] ?? '';
    for (const fragment of ['COURSE_BONUS_FLOW_MODE=review','offer_available','accepted','attached',
      'keep the dual-mode ADK','Never delete migrations','Never cancel accepted obligations',
      'Never reinterpret direct packages as review jobs']) expect(rollback).toContain(fragment);
    expect(rollback).toContain('accept the exact already delivered version');
    expect(rollback).toContain('No new offers or extensions');
  });

  it('pins provenance without claiming missing provider or broad-suite gates green', () => {
    const text = cutover();
    for (const fragment of ['studyx-agent-a-canonical-v98','studyx-agent-a-brain-v134',
      '17a91049c10618e34274ea096ec9e29abcb527b3',
      '65e7632de64a0f33e47629a9283ede870e312c40cff94ce5eba2fc401b59c1ef',
      '889 passed, 7 failed, 1 skipped','contact-profile','clock/source-order sensitivity',
      'Retell/Xendra','supports_partial_recovery:true','Lucas','Thiago',
      'RELEASE_MANIFEST_TURN_PROMPT_REQUIRED']) expect(text).toContain(fragment);
    for (const relative of ['../../../docs/runbooks/whatsapp-go-live.md','../../../docs/handoffs/curso-de-regalo-en-el-alta.md']) {
      expect(readFileSync(resolve(__dirname, relative), 'utf8')).toContain('direct-course-bonus-v2-cutover.md');
    }
  });
});
