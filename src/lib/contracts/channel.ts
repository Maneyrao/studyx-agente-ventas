/**
 * The channels a conversation can live on.
 *
 * This type existed inline in six service signatures. Widening it in six places
 * is how one of them gets missed and a channel becomes half-supported — writable
 * through one path and rejected by another. It has a single home now, and it
 * mirrors the CHECK constraints in the schema.
 */
export type ConversationChannel = 'whatsapp' | 'voice' | 'telegram';
