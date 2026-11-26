import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-media-processing',entries=[
 ['compiled-first/actual-current-key.png','Decoded 96×64 original key result; independent pixel test proves outside alpha0 and red foreground alpha255. Viewer RGB alone is insufficient.'],
 ['compiled-first/actual-processed-fhd.png','Initial FHD white foreground over white background is a weak visual witness, retained as original. Stronger navy contrast below.'],
 ['compiled-first/actual-processed-four-k.png','3840×2160 decoded original: transparent left and opaque white right; source160×96 is not native4K detail.'],
 ['compiled-media-contrast/fhd-navy-contrast.png','1920×1080 shows navy beneath transparent left, white foreground right and navy canvas margin.'],
 ['compiled-media-contrast/four-k-alpha-contrast.png','3840×2160 alpha keeps transparent left and opaque white foreground right after background omission.'],
 ['compiled-media-contrast/key-png-on-navy.png','96×64 actual alpha composites as navy surrounding preserved red rectangle.'],
 ['compiled-first/browser/native-processing-desktop.png','Built page shows saved plan, source/result alpha checkerboards, explicit selection and project confirmation. Adoption persistence checked after reload separately.'],
 ['compiled-first/browser/native-processing-mock.png','Built mock clearly says no media generated; source remains visible, no real output adoption.'],
 ['compiled-first/browser/native-processing-viewer-mobile.png','390px viewer form disabled, private plan/job lists empty and controls fit viewport.']
],hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),result={result:'PASS',checkedAt:new Date().toISOString(),method:'Inspected all nine original local PNG files with view_image; playback, decoded alpha/audio and private HTTP evidence checked separately.',files:entries.map(([file,scope])=>({file:root+'/'+file,sha256:hash(root+'/'+file),result:'PASS',scope})),initialWhiteOnWhiteFhdIsWeakWitness:true,strongContrastSupplementDoesNotRewriteOriginalFiles:true,sourceIsSyntheticGraphicsAndPreviouslySavedSystemVoice:true,sourceResolutionIsNotNativeFourKDetail:true,actualVisualOnlyFiniteFixtures:true,modelSegmentationDenoisingAsrAccuracyAndNaturalPersonQualityAccepted:false,realCloneOrRealtimeOrTargetSpeakerIsolationAccepted:false,priorQualityFailuresRetained:true};fs.writeFileSync(root+'/visual-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',originalImages:entries.length}));
