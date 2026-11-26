import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {MemoryProof} from './native-guest-memory-proof-helpers.js';
import {NativeContentProofRuntime,proofHash} from './postgres-content-proof-runtime.js';
const label=process.argv[2],prior=process.argv[3];assert.match(label,/^[a-z][a-z0-9-]+$/);assert.ok(prior);
const previous=JSON.parse(fs.readFileSync(prior,'utf8')),c=await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-speaker-focus/'+label,prior),h=new MemoryProof(c);
let failure:unknown;
try{
 const files=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
 for(const file of files('dist'))assert.equal(proofHash(file),proofHash(path.join(c.compiledRoot,file)));
 await c.prepareResume();await h.web();const p=await h.page(await h.context(c.cookie));await p.goto('/speaker-references');await p.getByRole('heading',{name:'我的声音参考',exact:true}).waitFor();
 const state=await p.locator('.speaker-panel').last().textContent();await p.screenshot({path:path.join(c.out,'reference-select-observation.png'),fullPage:true});
 c.save('reference-select-observation.json',{sameRoot:c.cluster.root,originalRoot:previous.root,same76CompiledFiles:true,panelText:state,looseLabelCount:await p.getByLabel('选择本人参考').count(),exactLabelCount:await p.getByLabel('选择本人参考',{exact:true}).count(),selectLabels:await p.getByRole('combobox').evaluateAll(nodes=>nodes.map(n=>({label:n.closest('label')?.textContent,options:Array.from((n as HTMLSelectElement).options).map(o=>({value:o.value,text:o.textContent}))}))),pageErrors:h.errors,originalSuccessfulEnrollmentNotRepeated:true});c.add('read_only_original_instance_and_compiled_files_retained_for_locator_diagnosis');
}catch(error){failure=error;}
finally{await h.close();await c.finish(failure);}
