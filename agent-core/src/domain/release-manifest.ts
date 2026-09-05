const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export const REQUIRED_RELEASE_CONFIG_V1 = [
  'DATABASE_URL',
  'BUSINESS_WORKSPACE_SLUG',
  'ORCHESTRATOR_API_KEY',
  'ORCHESTRATOR_KEY_ID',
  'STUDYX_SIGNING_SECRET',
  'CRON_SECRET',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'PAYMENT_LINK_12M',
  'PAYMENT_LINK_6M',
  'PAYMENT_LINK_CONTADO',
  'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SHEETS_TAB_NAME',
] as const;

export interface ReleaseManifestV1 {
  readonly environment: string;
  readonly git_sha: string;
  readonly botpress_artifact_sha: string;
  readonly prompt_version: string;
  readonly provider: string;
  readonly model: string;
  readonly latest_migration: string;
  readonly catalog_source_sha256: string;
  /** Per-turn hash returned by runAgentTurnWithIntegrityV3. */
  readonly prompt_sha256: string;
  /** Stable release/template fingerprint, suitable for deployment parity. */
  readonly prompt_template_sha256: string;
  readonly tool_contract_version: string;
  readonly required_config: Readonly<Record<string, boolean>>;
  readonly complete: true;
  readonly built_at: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Validates the evidence object again at the authoritative commit boundary. */
export function parseReleaseManifestV1(value: unknown): ReleaseManifestV1 {
  const candidate = record(value);
  const requiredConfig = record(candidate?.required_config);
  const builtAt = text(candidate?.built_at);
  const valid = candidate !== null
    && SHA1.test(text(candidate.git_sha) ?? '')
    && SHA256.test(text(candidate.botpress_artifact_sha) ?? '')
    && SHA256.test(text(candidate.catalog_source_sha256) ?? '')
    && SHA256.test(text(candidate.prompt_sha256) ?? '')
    && SHA256.test(text(candidate.prompt_template_sha256) ?? '')
    && text(candidate.environment) !== null
    && text(candidate.prompt_version) !== null
    && text(candidate.provider) !== null
    && text(candidate.model) !== null
    && text(candidate.latest_migration) !== null
    && text(candidate.tool_contract_version) !== null
    && candidate.complete === true
    && builtAt !== null
    && Number.isFinite(Date.parse(builtAt))
    && requiredConfig !== null
    && REQUIRED_RELEASE_CONFIG_V1.every((key) => requiredConfig[key] === true);
  if (!valid) throw new Error('INVALID_AGENT_LOOP_RELEASE_MANIFEST');
  return candidate as unknown as ReleaseManifestV1;
}

/** Binds a release/template identity to the exact model input accepted for a turn. */
export function bindTurnPromptSha256V1(
  manifest: Omit<ReleaseManifestV1, 'prompt_sha256'>,
  promptSha256: string,
): ReleaseManifestV1 {
  return parseReleaseManifestV1({ ...manifest, prompt_sha256: promptSha256 });
}
