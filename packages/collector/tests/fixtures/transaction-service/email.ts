/**
 * Mock email service
 */
export async function sendEmail(opts: { to: string; subject: string; body: string }) {
  console.log('Sending email:', opts);
}
