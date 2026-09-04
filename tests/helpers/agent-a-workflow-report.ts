import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { summarizeWorkflowReportV1 } from './agent-a-workflow-metrics';

/** Cada resultado es inmutable; un fallo posterior no borra su evidencia. */
export function writeWorkflowReportV1(name: string, evidence: Record<string, unknown>): string {
  const generatedAt = new Date().toISOString();
  const runId = `${generatedAt.replace(/[:.]/gu, '-')}-${randomUUID()}`;
  const directory = process.env.STUDYX_WORKFLOW_REPORT_DIR
    ?? path.resolve(process.cwd(), 'botpress-agent/evals/results');
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${name}-${runId}.json`);
  writeFileSync(filename, `${JSON.stringify({
    ...evidence,
    metrics: summarizeWorkflowReportV1(evidence),
    run_id: runId,
    generated_at: generatedAt,
    execution_harness: 'processInboundTurn',
    delivery_scope: 'local_adapter',
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return filename;
}
