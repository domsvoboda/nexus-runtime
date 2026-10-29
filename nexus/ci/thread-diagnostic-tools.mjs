// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

export function diagnosticEnvironment(files,work,input=process.env){
  const env={PATH:files+'/bin-arm64:/usr/bin:/bin',HOME:work+'/home',WINEPREFIX:work+'/pfx',WINEARCH:'win64',WINEDEBUG:'-all,err+sync,err+thread',WINEDLLPATH:files+'/lib/vkd3d:'+files+'/lib/wine',WINEDLLOVERRIDES:'winemenubuilder.exe=d;mscoree,mshtml=d;xgameruntime=b',LD_LIBRARY_PATH:files+'/lib/aarch64-linux-gnu:'+files+'/lib',FEX_APP_CONFIG_LOCATION:work+'/fex/',LC_ALL:'C'};
  for(const name of ['DISPLAY','XAUTHORITY'])if(input[name])env[name]=input[name];
  return env;
}

function identity(pid){
  try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1).split(' ')[19];}catch{return null;}
}

export async function diagnosticProbe(command,args,{env,cwd,log,debugLog,debugAfter=13000,timeout=45000,debugger:captureDebugger}={}){
  if(!path.isAbsolute(log)||!path.isAbsolute(debugLog)||timeout<=debugAfter)throw Error('Invalid private diagnostic paths or limits');
  const descriptor=fs.openSync(log,'wx',0o600),started=Date.now();
  let bytes=0,truncated=false,debugged=false,debugStatus=null,timedOut=false;
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  const birth=child.pid?identity(child.pid):null;
  const append=data=>{if(bytes+data.length<=16*1024*1024){fs.writeSync(descriptor,data);bytes+=data.length;}else truncated=true;};
  child.stdout.on('data',append);child.stderr.on('data',append);
  const capture=setTimeout(()=>{
    if(!birth||child.exitCode!==null||identity(child.pid)!==birth)return;
    debugged=true;
    const result=captureDebugger?captureDebugger(child.pid):spawnSync('/usr/bin/gdb',['-q','-nx','-batch','-iex','set auto-load off','-iex','set debuginfod enabled off','-p',String(child.pid),'-ex','set pagination off','-ex','info threads','-ex','info sharedlibrary','-ex','thread apply all bt 32','-ex','thread apply all info registers','-ex','thread apply all x/32gx $sp','-ex','info proc mappings','-ex','detach'],{env,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
    debugStatus=result.status??null;
    fs.writeFileSync(debugLog,(result.stdout||'')+(result.stderr||'')+(result.error?'\nDEBUGGER ERROR '+result.error.message:'')+'\n',{flag:'wx',mode:0o600});
  },debugAfter);
  const limit=setTimeout(()=>{timedOut=true;if(child.exitCode===null&&identity(child.pid)===birth)child.kill('SIGKILL');},timeout);
  try{
    return await new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal,timedOut,debugged,debugStatus,truncated,elapsedMs:Date.now()-started,pid:child.pid}));
    });
  }finally{clearTimeout(capture);clearTimeout(limit);fs.closeSync(descriptor);}
}
