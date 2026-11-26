import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Asset, DirectoryView, MemoryView } from '../packages/contracts/src/index.js';
import { NativeContentProofRuntime, proofBounded, proofHash } from './postgres-content-proof-runtime.js';
import { nativeCluster } from '../tests/integration/postgres-native-cluster.js';
import { privateDirectory } from '../tests/integration/enterprise-directory-access-fixtures.js';
import { syntheticPng } from '../packages/media/src/index.js';
import { createPostgresClient, identifier, type PostgresConnectionConfig } from '../packages/postgres/src/config.js';
import { observeRecoveryClusters } from './native-recovery-owned.js';

const base = 'docs/evidence/T20/postgres-recovery-directory-erasure';
const resume = process.argv[2] === 'resume', priorLabel = 'directory-erasure-recovery-compiled';
const label = resume ? 'directory-erasure-recovery-compiled-continued' : priorLabel, audit = process.argv[3];
if (resume) assert.ok(audit, 'Resuming the failed fixture requires a fresh strict closure audit');
const c = resume ? await NativeContentProofRuntime.resume(base + '/' + label, base + '/' + priorLabel + '/proof.json', undefined, { preservePortsWithAudit: audit! }) : await NativeContentProofRuntime.create(base + '/' + label);
const configFile = path.join(c.cluster.root, 'directory-private/directory-config.json');
const configuration = resume ? { ...JSON.parse(fs.readFileSync(configFile, 'utf8')) as ReturnType<typeof privateDirectory>, file: configFile } : privateDirectory(path.join(c.cluster.root, 'directory-private'), c.nativeDir);
const provider = configuration.providers[0], originalEnv = c.env.bind(c);
c.env = (file?, port?) => ({ ...originalEnv(file, port), ENTERPRISE_DIRECTORY_CONFIG_FILE: configuration.file });
const keyFile = path.join(c.cluster.root, 'compiled-backup-key.private');
const archive = path.join(c.cluster.root, 'compiled-backup.dgr');
const storeDir = path.join(c.cluster.root, 'compiled-journal');
const offline = path.join(c.cluster.root, 'original-directory-data-offline');
const stateFile = path.join(c.cluster.root, 'compiled-directory-erasure-state.private.json');
const workspaceId = '20000000-0000-4000-8000-000000000001';
const tenantId = '10000000-0000-4000-8000-000000000001';
const priorState = resume ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
if (resume) assert.equal(priorState.backup, undefined, 'This continuation is limited to the failed fixture before its first backup');
const users: Record<string, string> = priorState.users ?? {}, state: Record<string, unknown> = priorState, done: string[] = priorState.done ?? [];
let target: Awaited<ReturnType<typeof nativeCluster>> | undefined;
let targetApi: PostgresConnectionConfig | undefined, targetWorker: PostgresConnectionConfig | undefined;
let finishing = false, memory: MemoryView, asset: Asset;
function retain() {
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, done, users, root: c.cluster.root, schema: c.schema, dataDir: c.nativeDir, offline, keyFile, archive, storeDir, targetRoot: target?.root, targetApi, targetWorker, auth: { cookie: c.cookie, headers: c.headers, viewerCookie: c.viewerCookie } }, null, 2) + '\n');
}
async function stage(name: string, work: () => Promise<void>) {
  if (done.includes(name)) return;
  await work(); done.push(name); retain(); c.add(name);
}
async function command<T>(label: string, args: string[], expected = 0) {
  const flags = ['backup', 'verify', 'restore'].includes(args[0]) ? ['--tools-dir', path.resolve('storage/tools/postgresql/18.7-2')] : [];
  const child = c.start(label, process.execPath, ['dist/postgres-recovery.mjs', ...args, ...flags]);
  const result = await proofBounded(child.closed, 120000, 'Compiled erasure recovery command did not close: ' + label);
  assert.equal(result.code, expected, child.stderr());
  return JSON.parse((expected ? child.stderr() : child.stdout()).trim().split('\n').at(-1)!) as T;
}
async function scim(method: 'POST' | 'DELETE', suffix: string, body?: object) {
  const r = await fetch('http://127.0.0.1:' + c.apiB + '/api/v1/scim/v2/' + provider.id + suffix, { method, headers: { authorization: 'Bearer ' + fs.readFileSync(provider.tokenFile, 'utf8').trim(), ...(body === undefined ? {} : { 'content-type': 'application/scim+json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, method === 'POST' ? 201 : 204);
  return method === 'POST' ? await r.json() : null;
}
async function newUser(key: string) {
  if (users[key]) return users[key];
  const id = (await scim('POST', '/Users', { userName: 'compiled-' + key + '@example.invalid', displayName: '合成编译目录' + key, externalId: 'external-' + key, emails: [{ value: key + '-private@example.invalid' }] })).id as string;
  users[key] = id; retain();
  await c.owner(db => db.query('UPDATE users SET name=$1 WHERE id=$2', ['合成编译基础姓名' + key, id]));
  return id;
}
async function stopApis() {
  for (const p of c.running.filter(p => p.label.startsWith('api-') && p.child.exitCode === null && p.child.signalCode === null)) await c.stop(p);
}
async function targetOwner<T>(work: (client: ReturnType<typeof createPostgresClient>) => Promise<T>) {
  assert.ok(target); const db = createPostgresClient(target.connection); await db.connect();
  try { await db.query('SET search_path TO ' + identifier(c.schema) + ',pg_catalog,pg_temp'); return await work(db); } finally { await db.end(); }
}
function planArgs() {
  assert.ok(target); return ['--loader-file', target.connectionFile, '--data-dir', c.nativeDir, '--store-dir', storeDir, '--key-file', keyFile, '--plan-id', String(state.planId)];
}
async function blocked() {
  for (const config of [targetApi, targetWorker]) {
    assert.ok(config); const db = createPostgresClient(config); let denied = false;
    try { await db.connect(); } catch (error) { assert.equal((error as { code: string }).code, '42501'); denied = true; } finally { await db.end(); }
    assert.ok(denied);
  }
}
async function snapshot() {
  return targetOwner(async db => {
    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const t of ['users', 'enterprise_directory_users', 'enterprise_directory_profile_erasures', 'enterprise_directory_events', 'enterprise_directory_groups', 'enterprise_directory_group_members', 'enterprise_directory_access_bases', 'enterprise_member_directory', 'enterprise_member_controls', 'enterprise_identity_bindings', 'auth_sessions', 'enterprise_login_flows']) rows[t] = (await db.query('SELECT * FROM ' + t)).rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return rows;
  });
}
try {
  if (resume) {
    await c.prepareResume({ skipSyntheticLogins: true });
    c.cookie = priorState.auth.cookie; c.headers = priorState.auth.headers; c.viewerCookie = priorState.auth.viewerCookie;
    c.secrets.push(c.cookie, c.headers['x-csrf-token'], c.viewerCookie);
    assert.equal((await c.http('/api/v1/me', undefined, c.apiB, c.headers)).status, 200);
  } else await c.prepare({ contentModels: false });
  c.secrets.push(...configuration.providers.map(p => fs.readFileSync(p.tokenFile, 'utf8').trim()));
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const compiled = Object.fromEntries(walk('dist').map(f => [f.replaceAll('\\', '/'), proofHash(f)]));
  c.save('compiled-file-sha256.json', compiled);
  await stage('compiled_api_creates_scoped_synthetic_profiles_original_erasure_receipt_and_shared_environment', async () => {
    const view = await c.get<DirectoryView>('/enterprise/directory?workspaceId=' + workspaceId + '&connectorId=' + provider.id), p = view.connectors.find(p => p.id === provider.id)!;
    if (!p.enabled) await c.good('/enterprise/directory/connector', { workspaceId, connectorId: provider.id, version: p.version, configurationToken: p.configurationToken, enabled: true, confirmed: true });
    await newUser('existing_erasure'); await scim('DELETE', '/Users/' + users.existing_erasure);
    for (const key of ['exclusive', 'shared', 'unchanged']) await newUser(key);
    const at = new Date().toISOString();
    await c.owner(db => db.query("INSERT INTO enterprise_member_directory VALUES($1,$2,'live','production','viewer',$3,1,'existing',$4,$4)", [users.shared, tenantId, JSON.stringify([workspaceId]), at]));
    state.groupId = (await scim('POST', '/Groups', { displayName: '合成编译清理组', members: [{ value: users.exclusive }, { value: users.shared }] })).id;
    memory = await c.good<MemoryView>('/people/self', { workspaceId, displayName: '合成编译恢复资料', roles: ['customer'], consent: true, noticeVersion: 'memory-v1', retentionDays: 30 });
    memory = await c.good<MemoryView>('/people/' + memory.person!.id + '/facts', { key: 'like', value: '合成编译待清理偏好', visibility: 'private', expiresAt: memory.person!.expiresAt });
    const upload = await c.good<{ uploadId: string }>('/assets/uploads', { workspaceId, fileName: '合成编译恢复素材.png', contentBase64: syntheticPng([20, 90, 60]).toString('base64') });
    asset = await c.good<Asset>('/assets', { uploadId: upload.uploadId, name: '合成编译恢复素材', category: 'avatar' });
    state.personId = memory.person!.id; state.assetId = asset.id;
    state.jobId = (await c.good<{ id: string }>('/jobs', { workspaceId, kind: 'provider.check' })).id;
    await observeRecoveryClusters(base + '/observed-erasure-compiled-source-' + path.basename(c.cluster.root) + '.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.cluster.port);
  });
  await stage('compiled_cli_backs_up_and_verifies_517_tables_with_two_original_keys', async () => {
    await stopApis(); const key = randomBytes(32).toString('hex'); c.secrets.push(key); fs.writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 });
    const backup = await command<{ result: string; tableCount: number }>('erasure-backup', ['backup', '--config-file', c.apiPath, '--loader-file', c.cluster.connectionFile, '--output', archive, '--key-file', keyFile, '--confirm-stopped']);
    state.backup = backup; retain(); assert.equal(backup.result, 'PASS'); assert.equal(backup.tableCount, 517);
    const verified = await command<{ result: string }>('erasure-verify', ['verify', '--archive', archive, '--key-file', keyFile]);
    assert.equal(verified.result, 'PASS'); c.save('compiled-backup.json', { result: 'PASS', backup, verified, originalKeys: 2 });
  });
  await stage('compiled_scim_deletions_export_signed_opaque_scope_witness_bound_to_exact_journal_head', async () => {
    await c.api('api-post-backup-a'); await c.api('api-post-backup-b', c.apiB);
    await scim('DELETE', '/Users/' + users.exclusive); await scim('DELETE', '/Users/' + users.shared);
    await newUser('post_backup'); await scim('DELETE', '/Users/' + users.post_backup);
    await c.good('/people/' + memory.person!.id + '/erase', { version: memory.person!.version, confirmed: true });
    const archived = await fetch('http://127.0.0.1:' + c.apiA + '/api/v1/assets/' + asset.id, { method: 'PATCH', headers: { ...c.headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ version: asset.version, archived: true }), signal: AbortSignal.timeout(20000) });
    assert.equal(archived.status, 200);
    type Export = { headSHA256: string; reused: boolean; directoryErasureWitness: { file: string; sha256: string; entries: number } };
    const exported = await command<Export>('erasure-export', ['journal-export', '--config-file', c.apiPath, '--loader-file', c.cluster.connectionFile, '--store-dir', storeDir, '--key-file', keyFile]);
    state.exported = exported; retain(); assert.equal(exported.directoryErasureWitness.entries, 4);
    const witnessBytes = fs.readFileSync(exported.directoryErasureWitness.file), text = witnessBytes.toString('utf8');
    for (const privateText of ['合成编译目录', '合成编译基础姓名', 'private@example.invalid', 'external-exclusive']) assert.ok(!text.includes(privateText));
    const again = await command<Export>('erasure-export-reuse', ['journal-export', '--config-file', c.apiPath, '--loader-file', c.cluster.connectionFile, '--store-dir', storeDir, '--key-file', keyFile]);
    assert.equal(again.reused, true); assert.equal(again.headSHA256, exported.headSHA256); assert.deepEqual(fs.readFileSync(exported.directoryErasureWitness.file), witnessBytes);
    c.save('compiled-export.json', { result: 'PASS', exported, exactHeadAndWitnessReused: true, containsPersonalText: false });
    await observeRecoveryClusters(base + '/observed-erasure-compiled-post-backup-' + path.basename(c.cluster.root) + '.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.cluster.port);
    await stopApis();
  });
  await stage('compiled_cross_cluster_restore_preserves_517_tables_two_views_keys_and_database_quarantine', async () => {
    target = await nativeCluster(); retain();
    await observeRecoveryClusters(base + '/observed-erasure-compiled-target-' + path.basename(target.root) + '.json', target.observedPids, target.port);
    const root = await target.admin();
    try {
      await root.query('CREATE ROLE dg_compiled_erasure_padding NOLOGIN');
      for (const user of ['dg_native_api', 'dg_native_worker']) {
        const password = randomBytes(32).toString('hex'), file = path.join(target.root, user + '-password.private');
        fs.writeFileSync(file, password, { flag: 'wx', mode: 0o600 }); c.secrets.push(password);
        await root.query('CREATE ROLE ' + identifier(user) + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + password + "'");
      }
    } finally { await root.end(); }
    targetApi = { ...target.connection, user: 'dg_native_api', passwordFile: path.join(target.root, 'dg_native_api-password.private') };
    targetWorker = { ...target.connection, user: 'dg_native_worker', passwordFile: path.join(target.root, 'dg_native_worker-password.private') }; retain();
    assert.equal(fs.existsSync(offline), false);
    for (const dir of [offline, c.nativeDir]) assert.ok(path.resolve(dir).startsWith(path.resolve(c.cluster.root) + path.sep));
    fs.renameSync(c.nativeDir, offline);
    const restored = await command<{ result: string; tableCount: number; databaseQuarantined: boolean }>('erasure-restore', ['restore', '--archive', archive, '--loader-file', target.connectionFile, '--data-dir', c.nativeDir, '--key-file', keyFile, '--confirm-restore']);
    state.restored = restored; retain(); assert.equal(restored.result, 'PASS'); assert.equal(restored.tableCount, 517); assert.equal(restored.databaseQuarantined, true);
    const views = await targetOwner(async db => (await db.query('SELECT viewname FROM pg_views WHERE schemaname=$1 ORDER BY viewname', [c.schema])).rows.map(r => r.viewname));
    assert.deepEqual(views, ['_dg_native_effective_member_directory', '_dg_native_effective_memberships']);
    for (const key of c.keys) assert.equal(proofHash(path.join(c.nativeDir, key.name)), key.sha256);
    state.initialTarget = await snapshot(); retain(); await blocked();
    c.save('compiled-target.json', { root: target.root, port: target.port, sourceRoot: c.cluster.root, views, restored });
  });
  await stage('compiled_original_identity_and_directory_steps_are_required_before_profile_erasure_or_base_authority', async () => {
    assert.ok(target);
    const plan = await command<{ planId: string; status: string }>('erasure-plan', ['journal-plan', '--loader-file', target.connectionFile, '--data-dir', c.nativeDir, '--store-dir', storeDir, '--key-file', keyFile]);
    state.planId = plan.planId; retain(); assert.equal(plan.status, 'pending');
    const refused = await command<{ error: { code: string } }>('erasure-before-directory', ['directory-erasure-preview', ...planArgs()], 1);
    assert.equal(refused.error.code, 'PG_RECOVERY_DIRECTORY_ERASURE_DIRECTORY_REQUIRED');
    for (const [operation, confirmation] of [['identity', '--confirm-identity-restriction'], ['directory', '--confirm-directory-restriction']]) {
      const p = await command<{ previewSHA256: string }>('erasure-' + operation + '-preview', [operation + '-preview', ...planArgs()]);
      const applied = await command<{ receiptId: string }>('erasure-' + operation + '-apply', [operation + '-apply', ...planArgs(), '--preview-sha256', p.previewSHA256, confirmation]);
      state[operation + 'Receipt'] = applied.receiptId; retain();
    }
    const old = await command<{ error: { code: string } }>('erasure-base-before-cleanup', ['authority-preview', ...planArgs()], 1);
    assert.equal(old.error.code, 'PG_RECOVERY_AUTHORITY_DIRECTORY_ERASURE_REQUIRED');
  });
  await stage('compiled_erasure_preview_binds_exact_profiles_and_preserves_unmatched_post_backup_identity', async () => {
    const before = await snapshot();
    const preview = await command<{ previewSHA256: string; witnessEntries: number; matchedProfiles: number; unmatchedWitnessEntries: number; profilesToScrub: number; globalNamesToClear: number; basesToRemove: number; groupRelationsToRemove: number }>('erasure-preview', ['directory-erasure-preview', ...planArgs()]);
    state.preview = preview; retain();
    assert.equal(preview.witnessEntries, 4); assert.equal(preview.matchedProfiles, 3); assert.equal(preview.unmatchedWitnessEntries, 1); assert.equal(preview.profilesToScrub, 2); assert.equal(preview.globalNamesToClear, 1); assert.equal(preview.basesToRemove, 2); assert.equal(preview.groupRelationsToRemove, 2);
    assert.deepEqual(await snapshot(), before); c.save('compiled-preview.json', { result: 'PASS', preview, previewReadOnly: true });
  });
  await stage('compiled_missing_confirmation_wrong_digest_and_missing_witness_do_not_mutate_restored_data', async () => {
    const preview = state.preview as { previewSHA256: string }, before = await snapshot();
    const refused = await command<{ error: { code: string } }>('erasure-no-confirm', ['directory-erasure-apply', ...planArgs(), '--preview-sha256', preview.previewSHA256], 1);
    assert.equal(refused.error.code, 'PG_RECOVERY_DIRECTORY_ERASURE_CONFIRMATION_REQUIRED');
    const wrong = await command<{ error: { code: string } }>('erasure-wrong-digest', ['directory-erasure-apply', ...planArgs(), '--preview-sha256', 'f'.repeat(64), '--confirm-directory-erasure'], 1);
    assert.equal(wrong.error.code, 'PG_RECOVERY_DIRECTORY_ERASURE_PREVIEW_MISMATCH');
    const witness = (state.exported as { directoryErasureWitness: { file: string } }).directoryErasureWitness.file, saved = witness + '.saved';
    for (const file of [witness, saved]) assert.ok(path.resolve(file).startsWith(path.resolve(c.cluster.root) + path.sep));
    assert.equal(fs.existsSync(saved), false); fs.renameSync(witness, saved);
    try { const missing = await command<{ error: { code: string } }>('erasure-missing-witness', ['directory-erasure-preview', ...planArgs()], 1); assert.equal(missing.error.code, 'PG_DIRECTORY_ERASURE_WITNESS_REQUIRED'); } finally { fs.renameSync(saved, witness); }
    assert.deepEqual(await snapshot(), before);
  });
  await stage('compiled_explicit_erasure_scrubs_proved_profiles_preserves_shared_names_and_never_forges_business_receipts', async () => {
    const preview = state.preview as { previewSHA256: string };
    const applied = await command<{ receiptId: string; profilesScrubbed: number; globalNamesCleared: number; activationAllowed: boolean }>('erasure-apply', ['directory-erasure-apply', ...planArgs(), '--preview-sha256', preview.previewSHA256, '--confirm-directory-erasure']);
    state.applied = applied; retain(); assert.equal(applied.profilesScrubbed, 2); assert.equal(applied.globalNamesCleared, 1); assert.equal(applied.activationAllowed, false);
    const after = await snapshot(), before = state.initialTarget as Awaited<ReturnType<typeof snapshot>>;
    for (const key of ['exclusive', 'shared']) {
      const row = after.enterprise_directory_users.find(r => r.id === users[key])!;
      for (const field of ['user_name', 'name_key']) assert.equal(row[field], 'deleted-' + users[key]);
      for (const field of ['display_name', 'display_key']) assert.equal(row[field], '已清理目录成员');
      assert.equal(row.external_id, null); assert.equal(Number(row.deleted), 1); assert.equal(Number(row.active), 0); assert.equal(Number(row.review_required), 1);
      assert.ok(!String(row.profile_json).includes('private@example.invalid'));
    }
    assert.equal(after.users.find(r => r.id === users.exclusive)?.name, '已清理目录成员');
    assert.equal(after.users.find(r => r.id === users.shared)?.name, '合成编译基础姓名shared');
    assert.deepEqual(after.enterprise_directory_users.find(r => r.id === users.unchanged), before.enterprise_directory_users.find(r => r.id === users.unchanged));
    assert.deepEqual(after.enterprise_member_directory.find(r => r.user_id === users.shared && r.environment === 'live'), before.enterprise_member_directory.find(r => r.user_id === users.shared && r.environment === 'live'));
    assert.deepEqual(after.enterprise_directory_profile_erasures, before.enterprise_directory_profile_erasures);
    assert.deepEqual(after.enterprise_directory_events, before.enterprise_directory_events); assert.equal(after.users.some(r => r.id === users.post_backup), false);
    c.save('compiled-applied.json', { result: 'PASS', applied, sharedAndOtherScopeDataPreserved: true, originalBusinessReceiptsPreserved: true, newIdentityCreated: false });
  });
  await stage('compiled_privacy_and_base_authority_continue_five_stage_chain_without_activation_or_queue_execution', async () => {
    for (const [operation, confirmation] of [['privacy', '--confirm-conservative-purge'], ['authority', '--confirm-conservative-restriction']]) {
      const p = await command<{ previewSHA256: string }>('erasure-' + operation + '-preview', [operation + '-preview', ...planArgs()]);
      const applied = await command<{ receiptId: string; activationAllowed: boolean }>('erasure-' + operation + '-apply', [operation + '-apply', ...planArgs(), '--preview-sha256', p.previewSHA256, confirmation]);
      state[operation + 'Receipt'] = applied.receiptId; retain(); assert.equal(applied.activationAllowed, false);
    }
    const values = await targetOwner(async db => ({ kinds: (await db.query('SELECT kind FROM public._dg_native_recovery_state_receipts ORDER BY kind')).rows.map(r => r.kind), person: (await db.query('SELECT status,display_name FROM people WHERE id=$1', [state.personId])).rows[0], asset: (await db.query('SELECT archived FROM assets WHERE id=$1', [state.assetId])).rows[0], attempts: (await db.query('SELECT attempts FROM jobs WHERE id=$1', [state.jobId])).rows[0].attempts }));
    assert.deepEqual(values.kinds, ['authority_v1', 'directory_authority_v1', 'directory_erasure_v1', 'identity_authority_v1', 'privacy_v1']);
    assert.deepEqual(values.person, { status: 'deleted', display_name: '已删除资料' }); assert.equal(Number(values.asset.archived), 1); assert.equal(Number(values.attempts), 0);
    c.save('compiled-five-stage-chain.json', { result: 'PASS', kinds: values.kinds, attempts: 0, wholePlanComplete: false, activationAllowed: false });
  });
  await stage('compiled_actual_target_restart_reuses_original_erasure_receipt_preserves_keys_and_blocked_roles', async () => {
    assert.ok(target); const before = await snapshot(); await target.stop(); await target.start();
    await observeRecoveryClusters(base + '/observed-erasure-compiled-target-restart-' + path.basename(target.root) + '.json', target.observedPids, target.port);
    assert.deepEqual(await snapshot(), before);
    const r = await command<{ receiptId: string; reused: boolean }>('erasure-reuse', ['directory-erasure-apply', ...planArgs(), '--preview-sha256', (state.preview as { previewSHA256: string }).previewSHA256, '--confirm-directory-erasure']);
    assert.equal(r.receiptId, (state.applied as { receiptId: string }).receiptId); assert.equal(r.reused, true);
    for (const key of c.keys) assert.equal(proofHash(path.join(c.nativeDir, key.name)), key.sha256);
    await blocked(); c.save('compiled-restart.json', { result: 'PASS', tables: 517, originalKeys: 2, originalReceiptReused: true, realTargetRestart: true, activationAllowed: false });
  });
  await stage('executed_compiled_files_and_checked_logs_match_current_artifacts_without_private_credentials', async () => {
    for (const [file, sha] of Object.entries(compiled)) { assert.equal(proofHash(file), sha, file); assert.equal(proofHash(path.join(c.compiledRoot, file)), sha, file); }
    for (const p of c.running) for (const secret of c.secrets.filter(s => s.length >= 16)) assert.ok(!p.stdout().includes(secret) && !p.stderr().includes(secret), 'Private credential appeared in process logs');
  });
  c.save('directory-erasure-recovery-summary.json', { result: 'PASS', compiledChecks: c.checks.length, compiledFiles: Object.keys(compiled).length, webFiles: Object.keys(compiled).filter(f => f.startsWith('dist/web/')).length, actualIndependentRestore: true, resumedOriginalFailedFixture: resume, initialSuccessfulUserCreationRepeated: false, realDirectoryProvider: false, businessLedgerReconstructed: false, wholeR119Complete: false, wholeG2Complete: false, workerStarted: false, contentModelsRead: false, productionActivation: false });
  await c.observe('observed-directory-erasure-recovery-final'); await target!.stop(); finishing = true; await c.finish();
  console.log(JSON.stringify({ result: 'PASS_COMPILED_DIRECTORY_ERASURE_RECOVERY', checks: c.checks.length }));
} catch (error) {
  if (finishing) throw error;
  try {
    if (target) await observeRecoveryClusters(base + '/observed-erasure-compiled-target-failure-' + process.pid + '.json', target.observedPids, target.port);
    await c.observe('observed-directory-erasure-recovery-failure');
  } finally { await target?.stop(); finishing = true; await c.finish(error); }
}
