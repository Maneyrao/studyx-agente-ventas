import { describe, expect, it } from 'vitest';

import {
  buildBotpressAdditiveEventUpdate,
  inspectBotpressRemoteCode,
  planBotpressAdditiveConversationTagPatch,
  planBotpressAdditiveEventPatch,
  planBotpressReviewedConfigurationUpdate,
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

const existingConfiguration = {
  data: {
    automationEnabled: true,
    apiBaseUrl: 'https://backend.example',
  },
  schema: {
    type: 'object',
    properties: {
      automationEnabled: { type: 'boolean', default: false },
      apiBaseUrl: { type: 'string', default: 'http://localhost:3000' },
    },
    required: [],
    additionalProperties: false,
  },
};

const commercialPlanningProperty = { type: 'boolean', default: false };
const legacyCommercialPlanningProperty = { type: 'boolean', default: true };
const generatedConfiguration = {
  schema: {
    ...existingConfiguration.schema,
    properties: {
      ...existingConfiguration.schema.properties,
      agentACommercialPlanningEnabled: commercialPlanningProperty,
    },
  },
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

  it('permits the exact Botpress runtime title tag as an additive contract', () => {
    const runtimeTitleTag = {
      title: 'Conversation title',
      description: 'Auto-generated by the Botpress runtime.',
    };
    const existingTags = {
      status: { title: 'Conversation status' },
      triggerE5F2C: commercialFollowupTriggerTag,
    };

    expect(planBotpressAdditiveConversationTagPatch({
      remoteTags: existingTags,
      generatedTags: { ...existingTags, title: runtimeTitleTag },
    })).toEqual({ title: runtimeTitleTag });

    expect(() => planBotpressAdditiveConversationTagPatch({
      remoteTags: existingTags,
      generatedTags: { ...existingTags, title: { ...runtimeTitleTag, title: 'Changed' } },
    })).toThrow('CONTRACT_CHANGED:conversation.tags.title');
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

  it('permits only the reviewed commercial-planning configuration addition and preserves all remote data', () => {
    const plan = planBotpressReviewedConfigurationUpdate({
      remoteConfiguration: existingConfiguration,
      generatedConfiguration,
    });

    expect(plan).toEqual({
      changed: true,
      configuration: {
        data: {
          ...existingConfiguration.data,
          agentACommercialPlanningEnabled: false,
        },
        schema: generatedConfiguration.schema,
      },
    });

    const update = buildBotpressAdditiveEventUpdate({
      botId: 'bot_123',
      code: 'compiled-code',
      eventPatch: {},
      configurationPlan: plan,
    });
    expect(update).toEqual({
      id: 'bot_123',
      code: 'compiled-code',
      configuration: plan.configuration,
    });
    expect(update).not.toHaveProperty('integrations');
    expect(update).not.toHaveProperty('plugins');
    expect(update).not.toHaveProperty('secrets');
  });

  it('is idempotent when the reviewed configuration and the default (false) value already exist', () => {
    const remoteConfiguration = {
      data: {
        ...existingConfiguration.data,
        agentACommercialPlanningEnabled: false,
      },
      schema: generatedConfiguration.schema,
    };
    const plan = planBotpressReviewedConfigurationUpdate({
      remoteConfiguration,
      generatedConfiguration,
    });

    expect(plan).toEqual({ changed: false, configuration: remoteConfiguration });
    expect(buildBotpressAdditiveEventUpdate({
      botId: 'bot_123', code: 'compiled-code', eventPatch: {}, configurationPlan: plan,
    })).toEqual({ id: 'bot_123', code: 'compiled-code' });
  });

  it('adds the default (false) data value when the reviewed schema already exists without a stored value', () => {
    expect(planBotpressReviewedConfigurationUpdate({
      remoteConfiguration: {
        data: existingConfiguration.data,
        schema: generatedConfiguration.schema,
      },
      generatedConfiguration,
    })).toMatchObject({
      changed: true,
      configuration: { data: { agentACommercialPlanningEnabled: false } },
    });
  });

  it('turns OFF a planner left ON by the previously reviewed default:true contract (owner 2026-11-09)', () => {
    const plan = planBotpressReviewedConfigurationUpdate({
      remoteConfiguration: {
        data: { ...existingConfiguration.data, agentACommercialPlanningEnabled: true },
        schema: { ...generatedConfiguration.schema, properties: {
          ...generatedConfiguration.schema.properties, agentACommercialPlanningEnabled: legacyCommercialPlanningProperty } },
      },
      generatedConfiguration,
    });
    expect(plan).toEqual({
      changed: true,
      configuration: {
        data: { ...existingConfiguration.data, agentACommercialPlanningEnabled: false },
        schema: generatedConfiguration.schema,
      },
    });
    expect(buildBotpressAdditiveEventUpdate({
      botId: 'bot_123', code: 'compiled-code', eventPatch: {}, configurationPlan: plan,
    })).toEqual({ id: 'bot_123', code: 'compiled-code', configuration: plan.configuration });
  });

  it('keeps an explicit owner flip to true once the current default:false contract is stored', () => {
    const remoteConfiguration = {
      data: { ...existingConfiguration.data, agentACommercialPlanningEnabled: true },
      schema: generatedConfiguration.schema,
    };
    expect(planBotpressReviewedConfigurationUpdate({ remoteConfiguration, generatedConfiguration }))
      .toEqual({ changed: false, configuration: remoteConfiguration });
  });

  it.each([
    ['stored non-boolean', {
      remoteConfiguration: {
        data: { ...existingConfiguration.data, agentACommercialPlanningEnabled: 'true' },
        schema: generatedConfiguration.schema,
      },
      generatedConfiguration,
    }],
    ['wrong reviewed property type', {
      remoteConfiguration: existingConfiguration,
      generatedConfiguration: {
        schema: {
          ...generatedConfiguration.schema,
          properties: {
            ...generatedConfiguration.schema.properties,
            agentACommercialPlanningEnabled: { type: 'string', default: true },
          },
        },
      },
    }],
    ['unreviewed additional property', {
      remoteConfiguration: existingConfiguration,
      generatedConfiguration: {
        schema: {
          ...generatedConfiguration.schema,
          properties: {
            ...generatedConfiguration.schema.properties,
            anotherFlag: { type: 'boolean', default: true },
          },
        },
      },
    }],
    ['changed existing property', {
      remoteConfiguration: existingConfiguration,
      generatedConfiguration: {
        schema: {
          ...generatedConfiguration.schema,
          properties: {
            ...generatedConfiguration.schema.properties,
            automationEnabled: { type: 'boolean', default: true },
          },
        },
      },
    }],
    ['changed required list', {
      remoteConfiguration: existingConfiguration,
      generatedConfiguration: {
        schema: { ...generatedConfiguration.schema, required: ['agentACommercialPlanningEnabled'] },
      },
    }],
  ])('rejects an unsafe configuration delta: %s', (_label, input) => {
    expect(() => planBotpressReviewedConfigurationUpdate(input)).toThrow();
  });

  it('reports unavailable instead of claiming a match when Botpress omits remote code', () => {
    expect(inspectBotpressRemoteCode({
      remoteCode: undefined,
      expectedSha256: 'expected-sha',
    })).toEqual({
      status: 'unavailable',
      type: 'undefined',
      byteLength: null,
      matches: null,
    });
  });

  it('verifies the byte length and hash when Botpress returns remote code', () => {
    expect(inspectBotpressRemoteCode({
      remoteCode: 'compiled-code',
      expectedSha256: '617dffca7824a53078ab80ddf2dd9f83394baf98d5a774810e17a6e3010402a2',
    })).toEqual({
      status: 'verified',
      type: 'string',
      byteLength: 13,
      matches: true,
    });
  });
});
