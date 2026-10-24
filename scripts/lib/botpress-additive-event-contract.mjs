import { createHash } from 'node:crypto';

const allowedEventName = 'studyxCommercialFollowup';
const allowedConversationTagName = 'triggerE5F2C';

const allowedEventContract = {
  description: 'Durable objection follow-up or authorized course-bonus review.',
  schema: {
    type: 'object',
    properties: {
      followup_id: {
        type: 'string',
        format: 'uuid',
        pattern: '^[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12}$',
      },
    },
    required: ['followup_id'],
    additionalProperties: false,
  },
};

const allowedConversationTagContract = {
  title: 'Trigger: onStudyxCommercialFollowup',
  description: 'Subscribe to events from trigger "onStudyxCommercialFollowup" (use "*" for all events or specific values)',
};

const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    )
    : value;

const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const normalizedEvent = (event) => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  if (!event.attributes || Object.keys(event.attributes).length > 0) return event;
  const normalized = { ...event };
  delete normalized.attributes;
  return normalized;
};

const eventsEqual = (left, right) => equal(normalizedEvent(left), normalizedEvent(right));

const assertRecord = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`INVALID_EVENT_CONTRACT:${label}`);
  }
};

export function inspectBotpressRemoteCode({ remoteCode, expectedSha256 }) {
  if (typeof remoteCode !== 'string') {
    return {
      status: 'unavailable',
      type: typeof remoteCode,
      byteLength: null,
      matches: null,
    };
  }

  const matches = createHash('sha256').update(remoteCode).digest('hex') === expectedSha256;
  return {
    status: matches ? 'verified' : 'mismatch',
    type: 'string',
    byteLength: Buffer.byteLength(remoteCode),
    matches,
  };
}

export function planBotpressAdditiveEventPatch({ remoteEvents, generatedEvents }) {
  assertRecord(remoteEvents, 'remote');
  assertRecord(generatedEvents, 'generated');

  const remoteKeys = Object.keys(remoteEvents).sort();
  const generatedKeys = Object.keys(generatedEvents).sort();
  const removed = remoteKeys.filter((key) => !generatedKeys.includes(key));
  const added = generatedKeys.filter((key) => !remoteKeys.includes(key));

  if (removed.length > 0 || added.some((key) => key !== allowedEventName) || added.length > 1) {
    throw new Error(`CONTRACT_KEYS_CHANGED:events:added=${added.join(',')}:removed=${removed.join(',')}`);
  }

  for (const key of remoteKeys) {
    if (!eventsEqual(remoteEvents[key], generatedEvents[key])) {
      throw new Error(`CONTRACT_CHANGED:events.${key}`);
    }
  }

  const reviewedEvent = generatedEvents[allowedEventName];
  if (reviewedEvent !== undefined && !eventsEqual(reviewedEvent, allowedEventContract)) {
    throw new Error(`CONTRACT_CHANGED:events.${allowedEventName}`);
  }

  return added.length === 1
    ? { [allowedEventName]: reviewedEvent }
    : {};
}

export function planBotpressAdditiveConversationTagPatch({ remoteTags, generatedTags }) {
  assertRecord(remoteTags, 'remote-conversation-tags');
  assertRecord(generatedTags, 'generated-conversation-tags');

  const remoteKeys = Object.keys(remoteTags).sort();
  const generatedKeys = Object.keys(generatedTags).sort();
  const removed = remoteKeys.filter((key) => !generatedKeys.includes(key));
  const added = generatedKeys.filter((key) => !remoteKeys.includes(key));

  if (removed.length > 0
    || added.some((key) => key !== allowedConversationTagName)
    || added.length > 1) {
    throw new Error(`CONTRACT_KEYS_CHANGED:conversation.tags:added=${added.join(',')}:removed=${removed.join(',')}`);
  }

  for (const key of remoteKeys) {
    if (!equal(remoteTags[key], generatedTags[key])) {
      throw new Error(`CONTRACT_CHANGED:conversation.tags.${key}`);
    }
  }

  const reviewedTag = generatedTags[allowedConversationTagName];
  if (reviewedTag !== undefined && !equal(reviewedTag, allowedConversationTagContract)) {
    throw new Error(`CONTRACT_CHANGED:conversation.tags.${allowedConversationTagName}`);
  }

  return added.length === 1
    ? { [allowedConversationTagName]: reviewedTag }
    : {};
}

export function buildBotpressAdditiveEventUpdate({
  botId,
  code,
  eventPatch,
  conversationTagPatch = {},
}) {
  if (typeof botId !== 'string' || botId.length === 0) throw new Error('INVALID_BOT_ID');
  if (typeof code !== 'string' || code.length === 0) throw new Error('INVALID_BOT_CODE');
  assertRecord(eventPatch, 'patch');
  assertRecord(conversationTagPatch, 'conversation-tag-patch');

  const eventKeys = Object.keys(eventPatch);
  if (eventKeys.some((key) => key !== allowedEventName) || eventKeys.length > 1) {
    throw new Error('UNREVIEWED_EVENT_PATCH');
  }
  if (eventKeys.length === 1 && !eventsEqual(eventPatch[allowedEventName], allowedEventContract)) {
    throw new Error(`CONTRACT_CHANGED:events.${allowedEventName}`);
  }

  const conversationTagKeys = Object.keys(conversationTagPatch);
  if (conversationTagKeys.some((key) => key !== allowedConversationTagName)
    || conversationTagKeys.length > 1) {
    throw new Error('UNREVIEWED_CONVERSATION_TAG_PATCH');
  }
  if (conversationTagKeys.length === 1
    && !equal(conversationTagPatch[allowedConversationTagName], allowedConversationTagContract)) {
    throw new Error(`CONTRACT_CHANGED:conversation.tags.${allowedConversationTagName}`);
  }

  return {
    id: botId,
    code,
    ...(eventKeys.length === 1 ? { events: eventPatch } : {}),
    ...(conversationTagKeys.length === 1 ? { conversation: { tags: conversationTagPatch } } : {}),
  };
}
