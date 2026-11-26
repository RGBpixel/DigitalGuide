import {clearExclusiveDirectoryName} from './directory-name-redaction.js';
import type {SQLInputValue} from 'node:sqlite';
import type {Repository} from '@digitalguide/database';
import type {IdentityWorkflow} from '../../../packages/enterprise/src/identity-workflows.js';
export class SqliteIdentityStore{
 constructor(readonly repo:Repository,readonly rotateDirectoryToken?:(id:string)=>void){}
 run<T>(workflow:IdentityWorkflow<T>):T{return this.repo.transaction(()=>this.runInTransaction(workflow));}
 runInTransaction<T>(workflow:IdentityWorkflow<T>):T{if(!this.repo.db.isTransaction)throw new Error('Identity workflow requires an open transaction');let step=workflow.next();while(!step.done){const operation=step.value;let result:unknown;if(operation.kind==='query'){if(/^SELECT\b/i.test(operation.sql))result=this.repo.all(operation.sql,...operation.args as SQLInputValue[]);else{this.repo.run(operation.sql,...operation.args as SQLInputValue[]);result=[];}}else if(operation.kind==='provisionUser'){this.repo.run('INSERT INTO users VALUES(?,?)',operation.userId,operation.name);this.repo.run('INSERT INTO memberships VALUES(?,?,?,?)',operation.userId,operation.tenantId,'viewer','[]');}else if(operation.kind==='clearDirectoryGlobalName')result=clearExclusiveDirectoryName(this.repo,operation);else if(operation.kind==='rotateDirectoryToken'){if(!this.rotateDirectoryToken)throw new Error('Directory revocation is unavailable');this.rotateDirectoryToken(operation.connectorId);}else if(operation.kind==='now')result=new Date().toISOString();step=workflow.next(result);}return step.value;}
}
