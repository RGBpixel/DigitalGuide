import {build} from 'esbuild';
await build({entryPoints:['packages/media/src/share-player.ts'],outfile:'dist/share-player.js',bundle:true,platform:'browser',format:'iife',target:['chrome110','safari16'],minify:true,legalComments:'inline'});
