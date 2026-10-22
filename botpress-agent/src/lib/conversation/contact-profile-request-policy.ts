import { CONTACT_PROFILE_FIELDS_V1, type ContactProfileFieldV1 } from '../../../../src/shared/conversation/contact-profile-contract';
import type { TurnRejectionV1 } from '../../schemas/turn-rejection';

/** One contract for provider schemas and runtime enforcement after a receipt. */
export function eligibleContactRequestFieldsV1(input: {
  readonly values?: Partial<Record<ContactProfileFieldV1, string | null>> | null;
  readonly mode: 'collect' | 'clarify';
  readonly rejection?: Pick<TurnRejectionV1, 'rejections'> | null;
  /** Known values that still need channel-specific evidence for this purpose. */
  readonly collectable_confirmed_fields?: readonly ContactProfileFieldV1[];
}): ContactProfileFieldV1[] {
  const rejected = new Set((input.rejection?.rejections ?? [])
    .filter(item => item.code === 'ACTION_NOT_AUTHORIZED')
    .map(item => item.subject));
  const collectableConfirmed = new Set(input.collectable_confirmed_fields ?? []);
  return CONTACT_PROFILE_FIELDS_V1.filter(field => {
    if (input.values?.[field] == null) return true;
    if (input.mode === 'collect') return collectableConfirmed.has(field);
    // Changing a rejected collection to clarification cannot bypass the same
    // canonical fact. Unrelated genuine clarifications remain available.
    return !rejected.has(`contact_profile.already_confirmed.${field}`);
  });
}
