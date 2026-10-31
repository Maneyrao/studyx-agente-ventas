type Status = 'pending' | 'in_progress' | 'listening' | 'paused' | 'completed' | 'failed';

/** ADK getOrCreate deletes terminal instances excluded by its statuses filter.
 * Inspect with a preserving lookup first; ordinary releases retain their retry.
 */
export async function evidenceAwareWorkflow<T>(load: (statuses?: Status[]) => Promise<T>): Promise<T> {
  const existing = await load(['pending', 'in_progress', 'listening', 'paused', 'completed', 'failed']);
  const view = existing as { workflow?: { status: string }; tags?: Record<string, string | undefined> };
  if (['completed', 'failed'].includes(view.workflow?.status ?? '')
    && view.tags?.studyxEvidenceReview !== 'true') return load();
  return existing;
}
