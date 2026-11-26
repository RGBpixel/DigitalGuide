import type { SQLInputValue } from 'node:sqlite';
import type { Repository } from '../../database/src/index.js';
import type { NativePostgresDatabase } from '../../postgres/src/runtime-database.js';
import type { IdentityWorkflow } from './identity-workflows.js';
export class SqliteWebhookStore {
  constructor(readonly repository: Repository) {}
  run<T>(workflow: IdentityWorkflow<T>): T {
    return this.repository.transaction(() => { let step = workflow.next(); while (!step.done) {
      const operation = step.value; let result: unknown;
      if (operation.kind === 'now') result = new Date().toISOString();
      else if (operation.kind === 'query') { if (/^SELECT\b/i.test(operation.sql)) result = this.repository.all(operation.sql, ...operation.args as SQLInputValue[]); else { this.repository.run(operation.sql, ...operation.args as SQLInputValue[]); result = []; } }
      else throw new Error('Webhook worker accepts SQL and clock operations only');
      step = workflow.next(result);
    } return step.value; });
  }
}
export class NativeWebhookStore {
  constructor(readonly db: NativePostgresDatabase) {}
  async run<T>(workflow: IdentityWorkflow<T>): Promise<T> {
    return this.db.transaction(async () => { let step = workflow.next(); while (!step.done) {
      const operation = step.value; let result: unknown;
      if (operation.kind === 'now') result = await this.db.now();
      else if (operation.kind === 'query') { let i = 0; result = (await this.db.query((operation.postgresSql ?? operation.sql).replace(/\?/g, () => '$' + (++i)), operation.args)).rows; }
      else throw new Error('Webhook worker accepts SQL and clock operations only');
      step = workflow.next(result);
    } return step.value; });
  }
}
