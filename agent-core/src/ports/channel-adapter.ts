import type { ArtifactTableV3, ResponseBlockV3 } from '../domain/response-blocks';

export interface ChannelAdapter {
  readonly channel: 'telegram' | 'whatsapp' | 'voice';
  /** Un canal de voz no materializa igual que uno de texto. */
  render(
    blocks: readonly ResponseBlockV3[],
    table: ArtifactTableV3,
  ): { readonly text: string };
  readonly constraints: {
    readonly max_messages: number;
    /** `false` impide que un bloque de link llegue a un canal de voz. */
    readonly supports_urls: boolean;
  };
}
