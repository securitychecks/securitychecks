/**
 * Simple fixture for testing artifact extraction
 */

import { checkAuth } from './auth';

export interface User {
  id: string;
  name: string;
  email: string;
}

export async function getUser(userId: string): Promise<User> {
  await checkAuth();
  return { id: userId, name: 'Test User', email: 'test@example.com' };
}

export async function updateUser(userId: string, data: Partial<User>): Promise<User> {
  await checkAuth();
  return { id: userId, ...data } as User;
}

export async function deleteUser(userId: string): Promise<void> {
  await checkAuth();
  // Delete user
}
