import type { getInvariantById } from '@securitychecks/collector';

export function generateTestSkeleton(
  invariant: ReturnType<typeof getInvariantById>,
  framework: string,
  context?: string
): string {
  if (!invariant) return 'Unknown invariant';

  const testFn = framework === 'jest' ? 'test' : 'it';
  const describe = 'describe';

  switch (invariant.id) {
    case 'AUTHZ.SERVICE_LAYER.ENFORCED':
      return `
${describe}('Service Layer Authorization', () => {
  ${testFn}('should deny access without valid authorization', async () => {
    // Arrange: Create context without auth
    const unauthorizedContext = { userId: null, tenantId: null };

    // Act & Assert: Service call should throw
    await expect(
      yourService.sensitiveOperation({ context: unauthorizedContext })
    ).rejects.toThrow(/unauthorized|forbidden/i);
  });

  ${testFn}('should deny access to wrong tenant resources', async () => {
    // Arrange: User from tenant-1 trying to access tenant-2 resource
    const context = { userId: 'user-1', tenantId: 'tenant-1' };
    const resourceFromOtherTenant = { id: 'resource-1', tenantId: 'tenant-2' };

    // Act & Assert
    await expect(
      yourService.getResource({ context, resourceId: resourceFromOtherTenant.id })
    ).rejects.toThrow(/forbidden|access denied/i);
  });
});
`.trim();

    case 'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE':
      return `
${describe}('Membership Revocation', () => {
  ${testFn}('should deny access immediately after membership removal', async () => {
    // Arrange: User with team membership
    const userId = 'user-1';
    const teamId = 'team-1';
    await addMemberToTeam(userId, teamId);

    // Act: Remove membership
    await removeMemberFromTeam(userId, teamId);

    // Assert: Immediate access denial (no TTL grace period)
    await expect(
      accessTeamResource({ userId, teamId })
    ).rejects.toThrow(/forbidden|not a member/i);
  });

  ${testFn}('should invalidate cached membership on role downgrade', async () => {
    // Arrange: Admin user
    const userId = 'user-1';
    const teamId = 'team-1';
    await setUserRole(userId, teamId, 'admin');

    // Prime the cache
    await getTeamMembership(userId, teamId);

    // Act: Downgrade to member
    await setUserRole(userId, teamId, 'member');

    // Assert: Admin action should fail immediately
    await expect(
      performAdminAction({ userId, teamId })
    ).rejects.toThrow(/forbidden|requires admin/i);
  });
});
`.trim();

    case 'WEBHOOK.IDEMPOTENT':
      return `
${describe}('Webhook Idempotency', () => {
  ${testFn}('should handle duplicate webhook events idempotently', async () => {
    // Arrange: Create a webhook event
    const event = {
      id: 'evt_test_123',
      type: 'payment.succeeded',
      data: { amount: 1000 }
    };

    // Act: Process the same event twice
    await processWebhook(event);
    await processWebhook(event); // Duplicate

    // Assert: Side effect only happened once
    const payments = await getPaymentRecords();
    expect(payments.filter(p => p.eventId === event.id)).toHaveLength(1);
  });

  ${testFn}('should store event ID to prevent duplicates', async () => {
    const event = { id: 'evt_test_456', type: 'payment.succeeded' };

    await processWebhook(event);

    // Verify idempotency key was stored
    const stored = await getProcessedEventIds();
    expect(stored).toContain(event.id);
  });
});
`.trim();

    case 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS':
      return `
${describe}('Post-Commit Side Effects', () => {
  ${testFn}('should not send email if transaction rolls back', async () => {
    const emailSpy = vi.spyOn(emailService, 'send');

    // Act: Trigger action that should fail and rollback
    await expect(
      createOrderWithInvalidData({ /* invalid data causing rollback */ })
    ).rejects.toThrow();

    // Assert: No email was sent
    expect(emailSpy).not.toHaveBeenCalled();
  });

  ${testFn}('should send email only after successful commit', async () => {
    const emailSpy = vi.spyOn(emailService, 'send');

    // Act: Successful order creation
    await createOrder({ productId: 'prod-1', quantity: 1 });

    // Assert: Email was sent
    expect(emailSpy).toHaveBeenCalledOnce();
  });
});
`.trim();

    default:
      return `
${describe}('${invariant.name}', () => {
  ${testFn}('should enforce ${invariant.id}', async () => {
    // TODO: Implement test for ${invariant.id}
    // Required proof: ${invariant.requiredProof}
    ${context ? `// Context: ${context}` : ''}

    throw new Error('Test not implemented');
  });
});
`.trim();
  }
}

/**
 * Returns the "A staff engineer would ask..." question for each invariant.
 * These are the probing questions that senior engineers ask in code review.
 */
export function getStaffQuestion(invariantId: string): string | null {
  const questions: Record<string, string> = {
    'AUTHZ.SERVICE_LAYER.ENFORCED':
      'What happens when a background job calls this function directly, bypassing the route?',
    'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE':
      'If I remove someone from a team right now, can they still access team resources?',
    'AUTHZ.KEYS.REVOCATION.IMMEDIATE':
      'If I revoke this API key, does it stop working immediately or is it cached?',
    'WEBHOOK.IDEMPOTENT':
      'What happens when Stripe retries this webhook? Will we double-charge the customer?',
    'TRANSACTION.POST_COMMIT.SIDE_EFFECTS':
      'If this transaction rolls back, did we already send an email the user will never receive?',
    'TESTS.NO_FALSE_CONFIDENCE':
      'Is this test actually verifying behavior, or just making CI green?',
    'CACHE.INVALIDATION.ON_AUTH_CHANGE':
      'When someone loses access, how long until the cache catches up?',
    'JOBS.RETRY_SAFE':
      'If this job runs twice, will we have duplicate data or double-bill someone?',
    'BILLING.SERVER_ENFORCED':
      'Can someone bypass the paywall by calling the API directly?',
    'ANALYTICS.SCHEMA.STABLE':
      'If someone adds a field here, will it break our dashboards?',
  };
  return questions[invariantId] ?? null;
}

