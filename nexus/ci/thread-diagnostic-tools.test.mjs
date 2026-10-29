// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {diagnosticEnvironment,diagnosticProbe} from './thread-diagnostic-tools.mjs';

test('native diagnostic children never inherit tokens, accounts, profiles or preload hooks',()=>{
  const env=diagnosticEnvironment('/engine/files','/private/work',{DISPLAY:':1',XAUTHORITY:'/private/xauth',GH_TOKEN:'private',ACTIONS_RUNTIME_TOKEN:'private',XODUS_ACCESS_TOKEN:'private',WINEPREFIX:'/original',HOME:'/user',LD_PRELOAD:'injection',NODE_OPTIONS:'injection'});
  for(const key of ['GH_TOKEN','ACTIONS_RUNTIME_TOKEN','XODUS_ACCESS_TOKEN','LD_PRELOAD','NODE_OPTIONS'])assert.ok(!Object.hasOwn(env,key),key);
  assert.equal(env.HOME,'/private/work/home');assert.equal(env.WINEPREFIX,'/private/work/pfx');
  assert.equal(env.DISPLAY,':1');assert.equal(env.XAUTHORITY,'/private/xauth');
  assert.equal(env.FEX_APP_CONFIG_LOCATION,'/private/work/fex/');
});

test('diagnostic capture and timeout target only the newly spawned process',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-thread-diagnostic-'));
  try{
    const captured=[];
    const result=await diagnosticProbe(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{PATH:'/usr/bin:/bin'},cwd:root,log:root+'/probe.log',debugLog:root+'/gdb.txt',debugAfter:100,timeout:400,debugger:pid=>{assert.notEqual(pid,process.pid);process.kill(pid,0);captured.push(pid);return {status:0,stdout:'synthetic owned-child stack',stderr:''};}});
    assert.equal(result.timedOut,true);assert.equal(result.debugged,true);assert.equal(result.signal,'SIGKILL');
    assert.deepEqual(captured,[result.pid]);assert.match(await fs.readFile(root+'/gdb.txt','utf8'),/owned-child/);
    const success=await diagnosticProbe(process.execPath,['-e','console.log("fixture finished")'],{env:{PATH:'/usr/bin:/bin'},cwd:root,log:root+'/success.log',debugLog:root+'/unused.txt',debugAfter:1000,timeout:2000,debugger:()=>assert.fail('fast process must not be attached')});
    assert.equal(success.code,0);assert.equal(success.timedOut,false);assert.equal(success.debugged,false);
    await assert.rejects(fs.stat(root+'/unused.txt'),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('diagnostic workflow never builds, packages, promotes or uploads prefixes',async()=>{
  const workflow=await fs.readFile(new URL('../../.github/workflows/nexus-arm64-thread-diagnostic.yml',import.meta.url),'utf8');
  assert.match(workflow,/pull_request:/);assert.match(workflow,/runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow,/pull_request_target|contents: write|secrets\.|build-runtime|package-runtime|gh release|\*\*|\/pfx\//);
  const source=await fs.readFile(new URL('./arm64-thread-diagnostic.mjs',import.meta.url),'utf8');
  for(const text of ['promotable:false','stableApproved:false','realGameTest:false','Diagnostic FEX pin differs','Diagnostic dependency graph differs','Diagnostic download checksum mismatch'])assert.ok(source.includes(text),text);
});
