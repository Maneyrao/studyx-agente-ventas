export const WHATSAPP_TYPING_START_TIMEOUT_MS = 2_500

export async function settleWhatsAppTypingStartV1(
  providerRequest: Promise<unknown>,
): Promise<'started' | 'timed_out'> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      providerRequest.then(() => 'started' as const),
      new Promise<'timed_out'>((resolve) => {
        timeout = setTimeout(() => resolve('timed_out'), WHATSAPP_TYPING_START_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
