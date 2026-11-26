import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import type {MemoryView,GuestSessionView} from '../packages/contracts/src/index.js';
import {NativeContentProofRuntime} from './postgres-content-proof-runtime.js';
import {SpeakerUiProof} from './native-speaker-ui-browser-helpers.js';
const label=process.argv[2],prior=process.argv[3];assert.match(label,/^[a-z][a-z0-9-]+$/);assert.ok(prior);process.env.NATIVE_SPEAKER_UI_PREVIEW='0';
const c=await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-speaker-focus/'+label,prior),u=new SpeakerUiProof(c,label);let failure:unknown;
try{
 await u.open();const{g,p}=await u.fresh('原创默认专注界面编译验收'),initial=await u.h.get<GuestSessionView>(g);assert.equal(initial.features?.speakerFocus,true);assert.equal(initial.features?.speakerFocusPreview,false);assert.equal(initial.features?.speakerHandoffIntent,true);assert.equal(initial.audio.state,'mock_focus');await expect(p.getByText('匿名访客终端 · 模拟',{exact:true})).toBeVisible();await expect(p.getByText('模拟控制 · 未采集声纹',{exact:true})).toBeVisible();await u.start(p,g);await u.clear(p,g);u.record('compiled_default_native_mock_focus_ui_requires_no_preview_flag_and_still_requires_own_consent',{sessionId:g.id,previewFlag:'0',realRecognition:false});
 await u.focus(p,g,'/fallback',()=>u.panel(p).getByRole('button',{name:'改用文字并清理声音参考',exact:true}).click());await u.h.send(p,g,'原创默认界面文字回退问题');await u.handoff(p,g);const next=await u.arrived(p,g.id);assert.equal((await u.h.get<MemoryView>(next,'/memory')).person,null);const view=await u.h.current(next);assert.equal(view.features?.speakerFocus,true);assert.equal(view.features?.speakerFocusPreview,false);assert.equal(view.session.identity,'anonymous');u.record('compiled_default_ui_text_fallback_and_independent_handoff_open_new_unconsented_guest',{oldSessionId:g.id,newSessionId:next.id});await u.end(p,next);await u.shot(p,'default-native-guest-ended');
 for(const[role,file]of [['api',c.apiPath],['worker',c.workerPath]]){const checked=await c.cli('default-check-'+role,['check','--config-file',file,'--role',role]);assert.equal(checked.code,0);c.add('compiled_default_bundle_'+role+'_role_check_on_original_081_schema');}
}catch(error){failure=error;}finally{await u.finish(failure);}
