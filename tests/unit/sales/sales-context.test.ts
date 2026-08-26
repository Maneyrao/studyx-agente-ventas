import { describe, expect, it } from 'vitest';
import { SALES_CONTEXT_STAGES, isSalesPaymentPlan } from '@/features/sales/domain/sales-context';

describe('sales context domain', () => {
  it('limits durable payment state to the three owner-approved plans', () => {
    expect(['monthly_12', 'monthly_6', 'one_time'].every(isSalesPaymentPlan)).toBe(true);
    expect(isSalesPaymentPlan('monthly_3')).toBe(false);
    expect(isSalesPaymentPlan('360')).toBe(false);
  });

  it('has a closed finite set of commercial stages', () => {
    expect(SALES_CONTEXT_STAGES).toEqual([
      'exploring', 'qualified', 'course_selected', 'plan_selected',
      'payment_link_sent', 'handoff', 'closed',
    ]);
  });
});
