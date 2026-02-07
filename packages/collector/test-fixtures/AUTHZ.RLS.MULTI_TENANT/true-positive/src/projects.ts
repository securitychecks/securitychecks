// Database queries WITHOUT tenant filtering
// These should also trigger AUTHZ.TENANT.ISOLATION findings

import { prisma } from './db';

// BAD: No organizationId filter - potential cross-tenant data leak
export async function getAllProjects() {
  return prisma.project.findMany();
}

// BAD: Only filtering by user input, not tenant context
export async function getProjectById(id: string) {
  return prisma.project.findUnique({
    where: { id },
  });
}

// BAD: Listing all tasks without tenant context
export async function getProjectTasks(projectId: string) {
  return prisma.task.findMany({
    where: { projectId },
  });
}

// GOOD: This one has tenant filtering (should not trigger)
export async function getOrgProjects(organizationId: string) {
  return prisma.project.findMany({
    where: { organizationId },
  });
}
