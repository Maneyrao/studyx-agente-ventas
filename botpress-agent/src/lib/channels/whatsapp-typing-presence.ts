export const WHATSAPP_TYPING_START_TIMEOUT_MS = 2_500
export const WHATSAPP_TYPING_STOP_TIMEOUT_MS = 2_500

async function settleWhatsAppTypingPresenceV1<T extends string>(
  providerRequest: Promise<unknown>,
  accepted: T,
  timeoutMs: number,
): Promise<T | 'timed_out'> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      providerRequest.then(() => accepted),
      new Promise<'timed_out'>((resolve) => {
        timeout = setTimeout(() => resolve('timed_out'), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export async function settleWhatsAppTypingStartV1(
  providerRequest: Promise<unknown>,
): Promise<'started' | 'timed_out'> {
  return settleWhatsAppTypingPresenceV1(
    providerRequest,
    'started',
    WHATSAPP_TYPING_START_TIMEOUT_MS,
  )
}

export async function settleWhatsAppTypingStopV1(
  providerRequest: Promise<unknown>,
): Promise<'stopped' | 'timed_out'> {
  return settleWhatsAppTypingPresenceV1(
    providerRequest,
    'stopped',
    WHATSAPP_TYPING_STOP_TIMEOUT_MS,
  )
}
