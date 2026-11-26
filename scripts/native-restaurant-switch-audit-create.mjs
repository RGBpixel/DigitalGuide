import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('scripts/native-restaurant-session-audit.mjs','utf8');
const replace=(old,next)=>{assert.equal(source.split(old).length,2,old);source=source.replace(old,next);};
replace("root+'/terminal-phase-verification.json'","root+'/switch-phase-verification.json'");
replace("'PASS_LOCAL_RESTAURANT_SESSION_STAGE_WITH_RETAINED_FAILURES'","'PASS_LOCAL_VERSION_BOUND_SWITCH_WITH_RETAINED_OBSERVATION_FAILURE'");
replace('for(const old of [catalog,vision,speaker])historical(old);','assert.equal(hash(m.previousTerminalManifest),m.previousTerminalManifestSHA256);historical(read(m.previousTerminalManifest));for(const old of [catalog,vision,speaker])historical(old);');
replace('distinctPassingAssertions:26','distinctPassingAssertions:29');replace('currentGuiFlows:6','previousDefaultGuiFlows:6,currentSwitchGuiFlows:2,originalSwitchGuiSuitePassed:false');replace("nativeRuntime:85,nextMigration:'089'","nativeRuntime:86,nextMigration:'090'");replace("root+'/final-read-only-audit.json'","root+'/switch-final-read-only-audit.json'");
fs.writeFileSync('scripts/native-restaurant-switch-audit.mjs',source,{flag:'wx'});console.log('Created append-only switch auditor.');
