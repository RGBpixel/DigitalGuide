import {build} from 'esbuild';
await build({entryPoints:['packages/media/src/scorm-player.ts'],outfile:'dist/course-player.js',bundle:true,platform:'browser',format:'iife',target:['chrome110','safari16'],minify:true,legalComments:'inline'});
