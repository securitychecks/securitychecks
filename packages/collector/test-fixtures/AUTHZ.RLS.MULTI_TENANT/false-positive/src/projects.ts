// Database queries - RLS handles tenant filtering at DB level

import { prisma } from './db';

// OK: RLS policy automatically filters by organizationId
export async function getAllProjects() {
  return prisma.project.findMany();
}

// OK: RLS prevents cross-tenant access even without explicit filter
export async function getProjectById(id: string) {
  return prisma.project.findUnique({
    where: { id },
  });
}

// OK: RLS on Task table ensures tenant isolation
export async function getProjectTasks(projectId: string) {
  return prisma.task.findMany({
    where: { projectId },
  });
}
