import type { DbClient } from '@/lib/db/types';
import { COURSE_PROGRAM_ASSETS_V1, courseProgramChannelsV1, courseProgramUrlV1 } from '@/shared/catalog/course-programs';

/**
 * Programme PDF capability (owner decision 2026-11-04). Data only; wording is
 * the model's. `available`: active offerings with an official PDF, only when
 * the public asset base URL is configured and the conversation is on WhatsApp.
 * `sent`: programmes whose delivery already exists for this conversation
 * (pending or submitted; a failed one may be proposed again).
 */
export interface CourseProgramsCapabilityV1 {
  readonly available_offering_codes: readonly string[];
  readonly sent_offering_codes: readonly string[];
}

export async function readCourseProgramsCapabilityV1(input: {
  readonly workspace_slug: string;
  readonly conversation_id: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}, deps: { readonly db: DbClient }): Promise<CourseProgramsCapabilityV1 | null> {
  const env = input.env ?? process.env;
  const [conversation] = await deps.db<Array<{ channel: string }>>`
    SELECT channel FROM conversations WHERE id=${input.conversation_id}::uuid`;
  if (!conversation || !courseProgramChannelsV1(env).includes(conversation.channel)) return null;
  const sent = await deps.db<Array<{ offering_code: string }>>`
    SELECT offering_code FROM course_program_deliveries
    WHERE conversation_id=${input.conversation_id}::uuid AND status IN ('pending','submitted')`;
  const active = await deps.db<Array<{ code: string }>>`
    SELECT o.code FROM offerings o JOIN workspaces w ON w.id=o.workspace_id
    WHERE w.slug=${input.workspace_slug} AND o.status='active' AND o.offering_type='course'`;
  const available = active.map((row) => row.code)
    .filter((code) => COURSE_PROGRAM_ASSETS_V1.has(code) && courseProgramUrlV1(code, env) !== null);
  return { available_offering_codes: available, sent_offering_codes: sent.map((row) => row.offering_code) };
}
