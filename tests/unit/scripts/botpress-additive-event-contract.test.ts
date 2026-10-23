import { describe, expect, it } from 'vitest';

import {
  buildBotpressAdditiveEventUpdate,
  planBotpressAdditiveConversationTagPatch,
  planBotpressAdditiveEventPatch,
} from '../../../scripts/lib/botpress-additive-event-contract.mjs';

const commercialFollowupEvent = {
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

const existingEvents = {
  workflowSchedule: {
    description: 'Built-in scheduler event.',
    schema: { type: 'object', additionalProperties: false },
  },
  studyxPostSale: {
    description: 'Existing StudyX post-sale event.',
    schema: {
      type: 'object',
      properties: { notification_id: { type: 'string' } },
      required: ['notification_id'],
      additionalProperties: false,
    },
  },
};

const commercialFollowupTriggerTag = {
  title: 'Trigger: onStudyxCommercialFollowup',
  description: 'Subscribe to events from trigger "onStudyxCommercialFollowup" (use "*" for all events or specific values)',
};

describe('Botpress additive event publication contract', () => {
  it('permits only the reviewed commercial follow-up event as an additive patch', () => {
    const patch = planBotpressAdditiveEventPatch({
      remoteEvents: existingEvents,
      generatedEvents: {
        ...existingEvents,
        studyxCommercialFollowup: commercialFollowupEvent,
      },
    });

    expect(patch).toEqual({
      studyxCommercialFollowup: commercialFollowupEvent,
    });
  });

  it('is idempotent when the reviewed event already exists unchanged', () => {
    const events = {
      ...existingEvents,
      studyxCommercialFollowup: commercialFollowupEvent,
    };

    expect(
      planBotpressAdditiveEventPatch({
        remoteEvents: events,
        generatedEvents: events,
      }),
    ).toEqual({});
  });

  it('treats Botpress empty event attributes as equivalent to an omitted field', () => {
    expect(
      planBotpressAdditiveEventPatch({
        remoteEvents: {
          studyxPostSale: {
            ...existingEvents.studyxPostSale,
            attributes: {},
          },
        },
        generatedEvents: {
          studyxPostSale: existingEvents.studyxPostSale,
        },
      }),
    ).toEqual({});
  });

  it('rejects any unreviewed additive event', () => {
    expect(() =>
      planBotpressAdditiveEventPatch({
        remoteEvents: existingEvents,
        generatedEvents: {
          ...existingEvents,
          unexpectedEvent: commercialFollowupEvent,
        },
      }),
    ).toThrow('CONTRACT_KEYS_CHANGED:events');
  });

  it('rejects removal or modification of an existing event', () => {
    expect(() =>
      planBotpressAdditiveEventPatch({
        remoteEvents: existingEvents,
        generatedEvents: { workflowSchedule: existingEvents.workflowSchedule },
      }),
    ).toThrow('CONTRACT_KEYS_CHANGED:events');

    expect(() =>
      planBotpressAdditiveEventPatch({
        remoteEvents: existingEvents,
        generatedEvents: {
          ...existingEvents,
          studyxPostSale: {
            ...existingEvents.studyxPostSale,
            description: 'Changed remotely visible contract.',
          },
        },
      }),
    ).toThrow('CONTRACT_CHANGED:events.studyxPostSale');
  });

  it('permits only the ADK-generated tag for the reviewed commercial follow-up trigger', () => {
    const existingTags = {
      status: { title: 'Conversation status' },
    };

    expect(
      planBotpressAdditiveConversationTagPatch({
        remoteTags: existingTags,
        generatedTags: {
          ...existingTags,
          triggerE5F2C: commercialFollowupTriggerTag,
        },
      }),
    ).toEqual({ triggerE5F2C: commercialFollowupTriggerTag });

    expect(() =>
      planBotpressAdditiveConversationTagPatch({
        remoteTags: existingTags,
        generatedTags: {
          ...existingTags,
          unexpectedTag: commercialFollowupTriggerTag,
        },
      }),
    ).toThrow('CONTRACT_KEYS_CHANGED:conversation.tags');
  });

  it('builds a narrow update without dependency, configuration, secret, or null fields', () => {
    const update = buildBotpressAdditiveEventUpdate({
      botId: 'bot_123',
      code: 'compiled-code',
      eventPatch: { studyxCommercialFollowup: commercialFollowupEvent },
      conversationTagPatch: { triggerE5F2C: commercialFollowupTriggerTag },
    });

    expect(update).toEqual({
      id: 'bot_123',
      code: 'compiled-code',
      events: { studyxCommercialFollowup: commercialFollowupEvent },
      conversation: { tags: { triggerE5F2C: commercialFollowupTriggerTag } },
    });
    expect(JSON.stringify(update)).not.toContain('null');
  });
});
