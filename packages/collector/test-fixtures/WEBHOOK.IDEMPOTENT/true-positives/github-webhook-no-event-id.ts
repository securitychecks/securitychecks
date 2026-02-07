// @fixture: true-positive
// @invariant: WEBHOOK.IDEMPOTENT
// @expected-findings: 1
// @description: GitHub webhook handler without delivery ID tracking

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { triggerDeploy } from '@/lib/deploy';

/**
 * GitHub webhook handler WITHOUT idempotency
 * This should be flagged - doesn't track x-github-delivery
 */
export async function POST(req: NextRequest) {
  const event = req.headers.get('x-github-event');
  // Missing: const deliveryId = req.headers.get('x-github-delivery');

  const payload = await req.json();

  if (event === 'push') {
    // No check if we've processed this delivery before

    // Side effect - will trigger duplicate deploys
    await triggerDeploy({
      repo: payload.repository.full_name,
      branch: payload.ref.replace('refs/heads/', ''),
      commit: payload.after,
    });

    // Creates duplicate records
    await db.deployment.create({
      data: {
        repo: payload.repository.full_name,
        commit: payload.after,
        status: 'pending',
      },
    });
  }

  return NextResponse.json({ ok: true });
}
