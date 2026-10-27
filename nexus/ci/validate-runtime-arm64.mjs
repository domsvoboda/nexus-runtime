// SPDX-License-Identifier: MIT
// Native ARM64 candidate gates on an aarch64 host: exact layout, the shipped
// ARM64 prefix, and the C++ module loaded by aarch64, x86_64 (ARM64EC/FEX) and
// i386 (WoW64/FEX) processes. Synthetic and offline; no game or account.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {project,readJson,sourceEnvironment} from '../inputs.mjs';
import {fileHash,treeHash,assertPortable} from './provenance.mjs';
import {peMachine,elfMachine} from '../pe.mjs';
import {targets} from '../target.mjs';
const [outputArg,validationArg]=process.argv.slice(2);
if(process.argv.length!==4)throw Error('Usage: validate-runtime-arm64.mjs BUILD_OUTPUT NEW_VALIDATION');
if(process.arch!=='arm64')throw Error('ARM64 validation requires a native aarch64 host');
const target=targets.arm64,output=await fs.realpath(outputArg),work=path.resolve(validationArg);
const built=await readJson(output+'/built.json'),runtime=await fs.realpath(built.runtime),files=runtime+'/files';
if(path.dirname(runtime)!==output||built.metadata.stableApproved!==false||built.metadata.targetArchitecture!=='arm64')throw Error('Invalid isolated ARM64 runtime');
await fs.mkdir(work,{recursive:false});await fs.chmod(work,0o700);
for(const name of ['GCC-runtime-copyright','MinGW-runtime-copyright','libxml2-COPYING']){
  const source=project+'/licenses/'+name,file=files+'/share/doc/nexus-runtime/'+name;
  try{await fs.copyFile(source,file,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST'||await fileHash(file)!==await fileHash(source))throw e;}
}
await assertPortable(runtime);
const proof={schema:1,arch:'arm64',scope:'exact ARM64 runtime, synthetic offline gates only',realGameTest:false,realAccountTest:false,realCloudTest:false,stableApproved:false,graph:built.graph,runtime,builtSha256:await fileHash(output+'/built.json'),treeSha256:await treeHash(runtime),results:[]};
const engine=files+'/'+target.bin+'/wine';
let passed=false;
async function record(name,result,check){
  const log=work+'/'+name+'.log',text=(result.stdout||'')+(result.stderr||'')+(result.error?'\nERROR '+result.error.message:'');
  await fs.writeFile(log,text,{flag:'wx',mode:0o600});
  proof.results.push({name,status:result.status,signal:result.signal,error:result.error?.message,log,sha256:await fileHash(log)});
  if(result.status!==0||result.signal||result.error||!check(text))throw Error('ARM64 gate failed: '+name+'; '+log);
  console.log(name+' PASS');
}
try{
  // Layout: the launcher shim wraps the aarch64 loader and every PE module is a Wine builtin.
  const layout=[];
  if(elfMachine(await fs.readFile(engine))!=='aarch64'||elfMachine(await fs.readFile(engine+'.nexus-original'))!=='aarch64')throw Error('ARM64 loader is not native');
  layout.push('loader aarch64 shim and original');
  for(const arch of target.peArchitectures){
    const bytes=await fs.readFile(files+'/lib/wine/'+arch+'-windows/xgameruntime.dll');
    if(peMachine(bytes)!==arch||await fileHash(files+'/lib/wine/'+arch+'-windows/xgameruntime.dll')!==built.metadata.componentsByArchitecture[arch]['xgameruntime.dll'])throw Error('Unexpected C++ module: '+arch);
    if(peMachine(await fs.readFile(files+'/lib/wine/'+arch+'-windows/libnghttp2.dll'))!==arch)throw Error('Unexpected nghttp2 module: '+arch);
    layout.push(arch+' xgameruntime.dll and libnghttp2.dll');
  }
  for(const [name,hash]of Object.entries(built.metadata.components))if(await fileHash(files+'/share/'+target.prefix+'/drive_c/windows/system32/'+name)!==hash)throw Error('Prefix component differs: '+name);
  layout.push('default_pfx_arm64 system32 components: '+Object.keys(built.metadata.components).length);
  for(const [soname]of Object.entries(JSON.parse(await fs.readFile(project+'/runtime-media.lock.json','utf8')).libraries))if(elfMachine(await fs.readFile(files+'/lib/'+target.unixLibrary+'/'+soname))!=='aarch64')throw Error('Media library is not aarch64: '+soname);
  layout.push('aarch64 media libraries');
  await record('arm64-layout',{status:0,stdout:layout.join('\n')+'\n'},()=>true);
  // Probes are compiled in the same pinned ARM64 SDK that built the runtime.
  const probes=work+'/probes';await fs.mkdir(probes);
  await fs.copyFile(project+'/runtime-tests/arm64-load-probe.c',probes+'/probe.c');
  const containerEngine=process.env.NEXUS_CONTAINER_ENGINE||'docker';
  if(!['docker','podman'].includes(containerEngine))throw Error('Unsupported SDK engine');
  for(const [arch,compiler]of [['aarch64','aarch64-w64-mingw32-gcc'],['x86_64','x86_64-w64-mingw32-gcc'],['i386','i686-w64-mingw32-gcc']]){
    execFileSync(containerEngine,['run','--rm','--network=none',...(containerEngine==='podman'?['--userns=keep-id']:[]),'--user',`${process.getuid()}:${process.getgid()}`,'--mount',`type=bind,src=${probes},dst=/probes`,built.inputs.sdkArm64,compiler,'-O2','-Wall','-Werror','-o','/probes/probe-'+arch+'.exe','/probes/probe.c'],{env:sourceEnvironment(),stdio:'inherit',timeout:600000});
    if(peMachine(await fs.readFile(probes+'/probe-'+arch+'.exe'))!==arch)throw Error('Wrong probe machine: '+arch);
  }
  // Seed a prefix from the shipped ARM64 template as Proton's pfx_copy does:
  // relative links to Wine builtins become absolute, other links stay verbatim.
  const prefix=work+'/pfx',template=files+'/share/'+target.prefix;
  const builtin=/\/lib\/wine\/(?:i386|x86_64|aarch64)-(?:unix|windows)$/;
  async function seed(source,destination){
    await fs.mkdir(destination);
    for(const entry of await fs.readdir(source,{withFileTypes:true})){
      const from=path.join(source,entry.name),to=path.join(destination,entry.name);
      if(entry.isDirectory())await seed(from,to);
      else if(entry.isSymbolicLink()){
        const value=await fs.readlink(from);
        await fs.symlink(builtin.test(path.dirname(value))?path.resolve(source,value):value,to);
      }else await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);
    }
  }
  await seed(template,prefix);
  // default_pfx.py removes drive links; Proton's setup_prefix recreates them.
  await fs.mkdir(prefix+'/dosdevices',{recursive:true});
  for(const [drive,value]of [['c:','../drive_c'],['z:','/']])try{await fs.symlink(value,prefix+'/dosdevices/'+drive);}catch(e){if(e.code!=='EEXIST')throw e;}
  const env={...sourceEnvironment(),WINEPREFIX:prefix,WINEDEBUG:'-all',WINEDLLPATH:files+'/lib/vkd3d:'+files+'/lib/wine',WINEDLLOVERRIDES:'winemenubuilder.exe=d;mscoree,mshtml=d',LD_LIBRARY_PATH:files+'/lib/'+target.unixLibrary,FEX_APP_CONFIG_LOCATION:files+'/share/fex-emu/',PATH:files+'/'+target.bin+':'+process.env.PATH};
  const wine=(name,args,check)=>record(name,spawnSync(engine,args,{cwd:probes,env,encoding:'utf8',timeout:900000,maxBuffer:8*1024*1024}),check);
  await wine('arm64-prefix-boot',['wineboot','-u'],()=>true);
  for(const [arch,machine]of [['aarch64','0x0000'],['x86_64','0x0000'],['i386','0x014c']])
    await wine('arm64-load-'+arch,['probe-'+arch+'.exe'],text=>text.includes('MACHINE process='+machine+' native=0xaa64')&&/MODULE C:\\windows\\system32\\xgameruntime\.dll/i.test(text.replace(/syswow64/i,'system32'))&&text.includes('BUILTIN yes')&&text.includes('RESULT PASS'));
  const drain=spawnSync(files+'/'+target.bin+'/wineserver',['-w'],{env,timeout:60000,stdio:'ignore'});
  if(drain.status!==0||drain.error||drain.signal)throw Error('ARM64 prefix failed to drain');
  if(await fileHash(output+'/built.json')!==proof.builtSha256||await treeHash(runtime)!==proof.treeSha256)throw Error('Runtime changed during validation');
  passed=true;
}finally{
  proof.passed=passed;await fs.writeFile(work+'/results.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});console.log('VALIDATION_RESULT '+work+'/results.json');
}
if(!passed)process.exitCode=1;
