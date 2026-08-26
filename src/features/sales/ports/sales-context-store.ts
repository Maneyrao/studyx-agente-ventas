import type { SalesContextState, SalesContextTransition } from '../domain/sales-context';

export interface SalesContextStore {
  load(workspaceSlug: string, contactId: string): Promise<SalesContextState | null>;
  transition(input: SalesContextTransition): Promise<SalesContextState>;
}
