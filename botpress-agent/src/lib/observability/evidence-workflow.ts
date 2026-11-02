import type { Client } from '@botpress/client';

type Status = 'pending' | 'in_progress' | 'listening' | 'paused' | 'completed' | 'failed' | 'timedout' | 'cancelled';
type CreateArgs = Omit<Parameters<Client['getOrCreateWorkflow']>[0], 'status' | 'input'> & { input: Record<string, unknown> };
type WorkflowView = { id: string; status: Status; tags?: Record<string, string | undefined>; output?: Record<string, unknown> };
type WorkflowClient = {
  getOrCreateWorkflow: (input: CreateArgs & { status: 'pending' }) => Promise<{ workflow: WorkflowView }>;
  deleteWorkflow: (input: { id: string }) => Promise<unknown>;
};

/** ADK getOrCreate deletes terminal instances excluded by its statuses filter.
 * Inspect with a preserving lookup first; ordinary releases retain their retry.
 */
export async function evidenceAwareWorkflow<T>(load: (statuses?: Status[]) => Promise<T>): Promise<T> {
  const existing = await load(['pending', 'in_progress', 'listening', 'paused', 'completed', 'failed', 'timedout', 'cancelled']);
  const view = existing as { workflow?: { status: string; output?: Record<string, unknown>;
    tags?: Record<string, string | undefined> }; tags?: Record<string, string | undefined> };
  if (['completed', 'failed', 'timedout', 'cancelled'].includes(view.workflow?.status ?? '')
    && view.tags?.studyxEvidenceReview !== 'true'
    && view.workflow?.tags?.studyxEvidenceReview !== 'true'
    && !String(view.workflow?.output?.error_code ?? '').startsWith('TURN_EVIDENCE_')
    && view.workflow?.output?.outcome !== 'evidence_review_required') return load();
  return existing;
}

/** Use the public client, not ADK getOrCreate/load: ADK 2.0.8 registers an
 * unloaded TrackedState in the caller and its final autosave can overwrite
 * the worker's state with defaults. Keep worker state exclusively in worker.
 */
export async function getOrCreateEvidenceWorkflow(
  client: WorkflowClient,
  args: CreateArgs,
) {
  const result = await evidenceAwareWorkflow(async statuses => {
    let result = await client.getOrCreateWorkflow({ ...args, status: 'pending' });
    if (!(statuses ?? ['pending', 'in_progress', 'listening', 'paused']).includes(result.workflow.status as Status)) {
      await client.deleteWorkflow({ id: result.workflow.id });
      result = await client.getOrCreateWorkflow({ ...args, status: 'pending' });
    }
    return result;
  });
  return result.workflow;
}

/** Callback dispatch creates an unloaded ADK reference before invoking the
 * router. Hydrate that existing terminal reference before parent autosave.
 */
export async function hydrateWorkflowCallback(
  type: string, completion: unknown, hydrate: (id: string) => Promise<unknown>,
): Promise<boolean> {
  if (type !== 'workflow_callback') return false;
  const id = (completion as { workflow?: { id?: unknown } } | undefined)?.workflow?.id;
  if (typeof id !== 'string' || !id) throw new Error('WORKFLOW_CALLBACK_ID_MISSING');
  await hydrate(id);
  return true;
}
