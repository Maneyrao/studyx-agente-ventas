import { describe, expect, it } from 'vitest';
import type { DbClient } from '@/lib/db/types';
import { readPriorAlreadySaidV1 } from '@/features/conversation/application/read-prior-already-said';

describe('readPriorAlreadySaidV1 workspace isolation', () => {
  it('scopes recovered conversation links to the workspace resolved by the requested slug', async () => {
    const queries: string[] = [];
    const db = (async (strings: TemplateStringsArray) => {
      queries.push(strings.join('?'));
      return [];
    }) as unknown as DbClient;

    await readPriorAlreadySaidV1({
      workspace_slug: 'workspace-a',
      conversation_id: '00000000-0000-4000-8000-000000000001',
      contact_id: '00000000-0000-4000-8000-000000000002',
      source_turn_id: '00000000-0000-4000-8000-000000000003',
    }, { db });

    expect(queries).toHaveLength(1);
    const sql = queries[0]!.replace(/\s+/gu, ' ').replace(/\s*=\s*/gu, '=');
    expect(sql).toContain('l.workspace_id=root.workspace_id');
  });
});
