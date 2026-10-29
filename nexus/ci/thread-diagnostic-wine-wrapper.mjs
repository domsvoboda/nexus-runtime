// SPDX-License-Identifier: MIT
// Internal account-free Wine driver, not an application or a candidate gate.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {diagnosticProbe} from './thread-diagnostic-tools.mjs';
const [wine,root,...args]=process.argv.slice(2),target=path.basename(args[0]||'');
if(!wine||!root||!path.isAbsolute(wine)||!path.isAbsolute(root))throw Error('Owned engine and diagnostic root required');
if(!['nexus_user-device-association.exe','nexus_taskqueue-close.exe'].includes(target)){
  const result=spawnSync(wine,args,{env:process.env,cwd:process.cwd(),stdio:'inherit'});
  process.exit(result.status??1);
}
const prefix=fs.realpathSync(process.env.WINEPREFIX||'/missing'),owner=path.dirname(path.dirname(prefix));
if(![root+'/component-win64',root+'/component-win32'].includes(owner)||path.basename(prefix)!=='pfx')throw Error('Debugger prefix ownership mismatch');
const stem='full-'+path.basename(owner)+'-'+path.basename(path.dirname(prefix))+'-'+target;
const result=await diagnosticProbe(wine,args,{env:process.env,cwd:process.cwd(),log:root+'/'+stem+'.log',debugLog:root+'/'+stem+'-gdb.txt'});
fs.writeFileSync(root+'/'+stem+'.json',JSON.stringify(result)+'\n',{flag:'wx'});
process.stdout.write(fs.readFileSync(root+'/'+stem+'.log'));
process.exit(result.code??124);
