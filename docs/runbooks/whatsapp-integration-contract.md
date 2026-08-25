# Official Botpress WhatsApp Dependency Contract

## Scope

This fixture pins the public dependency metadata needed to implement the
official Botpress WhatsApp adapter. It is a local preparation record only: it
does not install, enable, configure, deploy, or exercise the integration.

## Resolved dependency

| Field | Pinned public value |
| --- | --- |
| Owner | Botpress Team |
| Alias / integration name | `whatsapp` |
| Version | `whatsapp@4.18.5` |
| Publication state | published |
| Runtime handler channel | `whatsapp.channel` |
| Configuration modes | `sandbox` (testing) and `manual` |

The development bot did not list a WhatsApp integration when this contract was
captured. Installing `whatsapp@4.18.5` remains a separately authorized action.

## Public inbound surface

The official integration declares support for inbound `text`, `audio`,
`image`, `video`, `file`, and `location` message types, plus its documented
WhatsApp event variants. The first canary adapter may intentionally accept a
smaller subset; it must reject unsupported types explicitly rather than
silently treating them as text.

The adapter contract consumes only these namespaced metadata keys, never their
values:

| Scope | Tag | Use in the canonical adapter |
| --- | --- | --- |
| Conversation | `whatsapp:userPhone` | Resolve the real user identity as strict E.164. |
| Conversation | `whatsapp:botPhoneNumberId` | Preserve non-secret sender identity metadata. |
| Message | `whatsapp:id` | Provider message identifier when supplied. |
| Message | `whatsapp:replyTo` | Preserve reply linkage. |
| Message | `whatsapp:status` | Distinguish delivery/status events from inbound content. |

No phone number, account identifier, access token, client secret, verify token,
webhook URL, payload body, or configuration value belongs in this fixture.

## Environment boundary

Botpress Cloud holds integration configuration separately for development and production.
A configuration, credential, or dependency state from development
must not be copied to production. Any later installation or configuration must
be performed in the intended Botpress Cloud environment with explicit approval.

## Capture provenance

Captured from read-only Botpress ADK/Hub metadata on 2026-08-25. The metadata
identified the official `whatsapp` integration at version `4.18.5` and its
`whatsapp.channel` runtime identifier; this repository stores no generated ADK
dependency snapshots or secret material.
