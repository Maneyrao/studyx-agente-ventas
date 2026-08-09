export interface ChannelSendInput {
  destination: string;
  content: string;
  idempotencyKey: string;
}

export interface ChannelSendResult {
  providerMessageId: string;
}

type ScriptedResult<T> = { type: 'return'; value: T } | { type: 'throw'; error: Error };

export class FakeEmbeddingProvider {
  readonly calls: string[] = [];
  private readonly script: ScriptedResult<number[]>[] = [];

  returnOnce(vector: number[] = Array.from({ length: 1536 }, () => 0)): void {
    this.script.push({ type: 'return', value: vector });
  }

  failOnce(error: Error = new Error('embedding provider unavailable')): void {
    this.script.push({ type: 'throw', error });
  }

  async generate(text: string): Promise<number[]> {
    this.calls.push(text);
    const next = this.script.shift();
    if (!next) return Array.from({ length: 1536 }, () => 0);
    if (next.type === 'throw') throw next.error;
    return next.value;
  }
}

export class FakeSummaryProvider {
  readonly calls: string[][] = [];
  private readonly script: ScriptedResult<string>[] = [];

  returnOnce(summary: string): void {
    this.script.push({ type: 'return', value: summary });
  }

  failOnce(error: Error = new Error('summary provider unavailable')): void {
    this.script.push({ type: 'throw', error });
  }

  async summarize(messages: string[]): Promise<string> {
    this.calls.push([...messages]);
    const next = this.script.shift();
    if (!next) return 'Resumen de prueba';
    if (next.type === 'throw') throw next.error;
    return next.value;
  }
}

export class FakeChannelProvider {
  readonly calls: ChannelSendInput[] = [];
  private readonly script: ScriptedResult<ChannelSendResult>[] = [];

  returnOnce(providerMessageId: string): void {
    this.script.push({ type: 'return', value: { providerMessageId } });
  }

  failOnce(error: Error = new Error('channel provider unavailable')): void {
    this.script.push({ type: 'throw', error });
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    this.calls.push({ ...input });
    const next = this.script.shift();
    if (!next) return { providerMessageId: `provider-${input.idempotencyKey}` };
    if (next.type === 'throw') throw next.error;
    return next.value;
  }
}
