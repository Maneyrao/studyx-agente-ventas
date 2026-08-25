import { secrets } from '@botpress/runtime'
import { attestWhatsAppCanaryAllowlist } from '../src/channels/whatsapp.channel'

// Deliberately prints only a value-safe proof. Never print the allowlist.
process.stdout.write(`STUDYX_WHATSAPP_CANARY_ATTESTATION=${JSON.stringify(
  attestWhatsAppCanaryAllowlist(secrets.WHATSAPP_CANARY_PHONE_E164S),
)}\n`)
