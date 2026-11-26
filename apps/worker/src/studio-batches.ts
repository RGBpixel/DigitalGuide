import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import type { Config } from '../../api/src/config.js';
import { StudioBatches,type BatchRow } from '../../api/src/studio-batch-service.js';
export function runStudioBatch(repo: Repository,config: Config) {
  const service = new StudioBatches(repo,config.providerMode,config.appEnv,config.dataDir,config.root);
  const batches = repo.all<BatchRow>("SELECT * FROM studio_batches WHERE environment=? AND app_env=? AND status IN ('running','paused') ORDER BY COALESCE(last_dispatch_at,created_at),id",config.providerMode,config.appEnv);
  for (const batch of batches) repo.transaction(() => service.reconcile(batch));
  for (const r of batches) {
    const item = service.items(r).find(i => i.status === 'queued');if (!item) continue;
    try { if (repo.transaction(() => service.dispatch(r,item))) return true; }
    catch (e) { if (e instanceof AppError && e.code === 'QUOTA_EXCEEDED') continue;repo.transaction(() => service.failQueued(r,item,e));return true; }
  }
  return false;
}
