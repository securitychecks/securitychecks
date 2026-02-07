// @fixture: true-positive
// @invariant: AUTHZ.SERVICE_LAYER.ENFORCED
// @expected-findings: 1
// @description: Next.js Server Action without auth check

'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

/**
 * Server action that creates a post without checking user identity
 * This should be flagged - server actions need auth
 */
export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  const content = formData.get('content') as string;

  // No auth check - anyone can create posts!
  await db.post.create({
    data: {
      title,
      content,
      // authorId is hardcoded or missing
    },
  });

  revalidatePath('/posts');
}

/**
 * Server action that deletes content without auth
 */
export async function deletePost(postId: string) {
  // No check if user owns this post
  await db.post.delete({
    where: { id: postId },
  });

  revalidatePath('/posts');
}
