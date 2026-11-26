import type { Repository } from '@digitalguide/database';
export function invalidateStudioReviews(repo: Repository,projectId: string,reason: string) {
  const at = new Date().toISOString();repo.run("UPDATE studio_reviews SET invalidated_at=?,invalidation_reason=?,version=version+1,updated_at=? WHERE project_id=? AND invalidated_at IS NULL AND status IN ('pending','approved')",at,reason,at,projectId);
}
