import fs from 'node:fs';
import assert from 'node:assert/strict';
const app='apps/web/src/App.tsx',source=fs.readFileSync(app,'utf8');assert.ok(source.includes('<div className="sidebar-bottom">'));fs.writeFileSync(app,source.replace('<div className="sidebar-bottom">','<div className="sidebar-bottom" onClick={()=>setMenuOpen(false)}>'));
const file='scripts/operations-directory-ui-proof.ts';let proof=fs.readFileSync(file,'utf8');const from=proof.indexOf('async function view(){'),to=proof.indexOf('\n',from);assert.ok(from>0&&to>from);proof=proof.slice(0,from)+proof.slice(to+1);proof=proof.replace('type {DirectoryView,DirectoryGroupsView,Me}','type {DirectoryGroupsView,Me}');fs.writeFileSync(file,proof);
