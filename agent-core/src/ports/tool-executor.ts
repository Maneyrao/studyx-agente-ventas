export interface ToolCallV3 {
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolResultV1<T = unknown> {
  readonly tool: string;
  readonly success: boolean;
  readonly canonical_data: T | null;
  readonly error_code: string | null;
  readonly recoverable: boolean;
  readonly idempotency_result: 'applied' | 'duplicate' | 'not_applicable';
  /** Sólo la clase preparación devuelve uno. */
  readonly preparation_id: string | null;
}

export interface ToolExecutor {
  execute(call: ToolCallV3): Promise<ToolResultV1>;
}
