/**
 * GitHub Webhook Handler - PARTIAL IDEMPOTENCY
 *
 * This handler extracts the delivery ID from headers but
 * DOES NOT persist it. This should trigger a P0 finding:
 * "Extracts event ID but doesn't persist it"
 */

import crypto from 'crypto';

export async function handleGithubWebhook(req: Request, res: Response) {
  const signature = req.headers['x-hub-signature-256'];
  const deliveryId = req.headers['x-github-delivery']; // Event ID extracted!
  const event = req.headers['x-github-event'];
  const body = await req.text();

  // Verify signature
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET!)
    .update(body)
    .digest('hex')}`;

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(body);

  // NOTE: We extract the delivery ID above but never store it!
  // This means duplicate deliveries will still be processed.
  console.log(`Processing GitHub ${event} webhook, delivery: ${deliveryId}`);

  switch (event) {
    case 'push':
      // DANGER: If GitHub retries, we'll trigger duplicate CI builds
      await triggerCIBuild(payload.repository, payload.ref);
      break;

    case 'pull_request':
      if (payload.action === 'opened') {
        // DANGER: Duplicate PR comments possible
        await postPRWelcomeComment(payload.pull_request);
      }
      break;

    case 'issues':
      if (payload.action === 'opened') {
        await notifySlackChannel(payload.issue);
      }
      break;
  }

  return res.status(200).json({ received: true });
}

// Simulated helpers
async function triggerCIBuild(_repo: unknown, _ref: string) {}
async function postPRWelcomeComment(_pr: unknown) {}
async function notifySlackChannel(_issue: unknown) {}

interface Request {
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}

interface Response {
  status(code: number): Response;
  send(body: string): void;
  json(body: unknown): void;
}
