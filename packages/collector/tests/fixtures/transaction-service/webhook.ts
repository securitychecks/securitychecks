/**
 * Mock webhook service
 */
export async function sendWebhook(opts: { event: string; data: any }) {
  console.log('Sending webhook:', opts);
}
