/**
 * Auth helper fixture
 */

export async function checkAuth(): Promise<void> {
  // Auth check
}

export async function requireAdmin(): Promise<void> {
  await checkAuth();
  // Check admin role
}
