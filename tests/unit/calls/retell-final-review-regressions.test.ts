import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveRetellProjectionTarget,
  retellPaymentProviderCanWireLiveOutbound,
} from '@/features/calls/domain/retell-final-review-policy';

describe('Retell final-review regression guards', () => {
  it('never uses the deployment-global Sheet for a different canonical workspace', () => {
    expect(resolveRetellProjectionTarget({
      configuredWorkspaceSlug: 'studyx',
      canonicalWorkspaceSlug: 'other-workspace',
      globalSheets: { spreadsheetId: 'sheet-a', tabName: 'Leads' },
      existingProjection: null,
    })).toBeNull();
    expect(resolveRetellProjectionTarget({
      configuredWorkspaceSlug: 'studyx',
      canonicalWorkspaceSlug: 'other-workspace',
      globalSheets: { spreadsheetId: 'sheet-a', tabName: 'Leads' },
      existingProjection: { spreadsheetId: 'sheet-b', tabName: 'Leads' },
    })).toEqual({ spreadsheetId: 'sheet-b', tabName: 'Leads' });
  });

  it('does not wire fake or test payments to live outbound Retell tools', () => {
    expect(retellPaymentProviderCanWireLiveOutbound('fake')).toBe(false);
    expect(retellPaymentProviderCanWireLiveOutbound('stripe_test')).toBe(false);
    expect(retellPaymentProviderCanWireLiveOutbound('stripe_live')).toBe(true);
  });

  it('requires the request workspace to equal the immutable call binding', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20260909000003_retell_orchestration_requests.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toMatch(/cs\.workspace_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+NEW\.workspace_id/iu);
  });
});
