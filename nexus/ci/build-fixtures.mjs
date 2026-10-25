// SPDX-License-Identifier: MIT
// This builds synthetic fixtures only. No host-built DLL is a runtime input.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {project,readJson,sourceEnvironment} from '../inputs.mjs';
import {fileHash} from './provenance.mjs';
import {buildPlayFabSessionProbe} from '../runtime-tests/build-playfab-session.mjs';
const [outputArg,fixturesArg,resumeArg]=process.argv.slice(2);
if(!outputArg||!fixturesArg||process.argv.length>5||resumeArg&&resumeArg!=='--resume')throw Error('Usage: build-fixtures.mjs BUILD_OUTPUT NEW_FIXTURES [--resume]');
const built=await readJson(path.resolve(outputArg,'built.json')),root=path.resolve(fixturesArg);
const selection={sdk:built.inputs.sdk,sourceGraph:built.graph,source:built.source,runtime:built.runtime};
if(resumeArg){
  if(JSON.stringify(await readJson(root+'/selection.json'))!==JSON.stringify(selection))throw Error('Fixture resume source mismatch');
  try{await fs.access(root+'/fixtures.json');throw Error('Do not alter sealed test fixtures');}catch(e){if(e.code!=='ENOENT')throw e;}
}else{
  await fs.mkdir(root,{recursive:false});
  await fs.writeFile(root+'/selection.json',JSON.stringify(selection)+'\n',{flag:'wx'});
}
const source=built.source,wine=source+'/wine',cpp=wine+'/dlls/xgameruntime',sdkBuild=built.prepared+'/sdk-build';
const engine=process.env.NEXUS_CONTAINER_ENGINE||'docker';
if(!['docker','podman'].includes(engine))throw Error('Unsupported SDK engine');
const env=sourceEnvironment(),plans=[];
function run(command,args,cwd=root,timeout=600000){plans.push({command,args});return execFileSync(command,args,{cwd,env,stdio:'inherit',timeout});}
for(const abi of ['win64','win32']) {
  const mounts=['--mount',`type=bind,src=${cpp},dst=/cpp,readonly`,'--mount',`type=bind,src=${wine},dst=/wine,readonly`,'--mount',`type=bind,src=${built.runtime},dst=/engine,readonly`,'--mount',`type=bind,src=${root},dst=/fixtures`,'--mount',`type=bind,src=${sdkBuild}/obj-wine-x86_64/tools/widl/widl,dst=/widl,readonly`];
  const base=['run','--rm','--network=none',...(engine==='podman'?['--userns=keep-id']:[]),'--user',`${process.getuid()}:${process.getgid()}`,'-e','CCACHE_DIR=/fixtures/compiler-cache','-e','CCACHE_MAXSIZE=128M','-e','CCACHE_COMPILERCHECK=content',...mounts,built.inputs.sdk];
  run(engine,[...base,'cmake','-S','/cpp','-B','/fixtures/'+abi,'-DCMAKE_TOOLCHAIN_FILE=/cpp/'+abi+'-target.cmake','-DENABLE_TESTS=ON','-DNEXUS_MIGRATION_PROBES=ON','-DNEXUS_WINE_SOURCE=/wine','-DWIDL=/widl','-DWINE_EXECUTABLE=/engine/files/bin/wine']);
  run(engine,[...base,'cmake','--build','/fixtures/'+abi,'--parallel','4']);
}
const native=path.join(root,'native');await fs.mkdir(native,{recursive:true});
const tests=path.join(project,'runtime-tests'),include=['-D__WINESRC__','-I',sdkBuild+'/obj-wine-x86_64/include','-I',wine+'/include'];
function compile(name,file,flags=[],bits=64,headers=false) {
  run(bits===64?'x86_64-w64-mingw32-gcc':'i686-w64-mingw32-gcc',[...(headers?include:[]),'-O2','-Wall',tests+'/'+file,'-o',native+'/'+name,...flags]);
}
for(const [name,flags]of [['appstate',[]],['appstate-source',['-DAPPSTATE_SOURCE_FIXTURE','-I',wine+'/dlls/twinapi.appcore']],['appconstrained',['-DAPPCONSTRAINED_PROBE']],['appconstrained-source',['-DAPPCONSTRAINED_PROBE','-DAPPSTATE_SOURCE_FIXTURE','-I',wine+'/dlls/twinapi.appcore']]])compile(name+'-probe.exe','appstate-probe.c',[...flags,'-Wextra','-Werror','-lruntimeobject'],64,true);
compile('hlsl-state-keywords-probe.exe','hlsl-state-keywords-probe.c',['-std=c11','-Wextra','-Werror','-DNEXUS_VKD3D_VERSION="'+built.inputs.shader.version+'"']);
compile('winrt-json-probe.exe','winrt-json-probe.c',['-lruntimeobject'],64,true);
for(const kind of ['vector','queue','yield'])for(const bits of [64,32])compile('concrt-'+kind+'-'+bits+'-probe.exe','concrt-'+kind+'-probe.c',['-Wextra','-Werror'],bits);
for(const bits of [64,32])compile('appmodel-'+bits+'-probe.exe','appmodel-probe.c',['-Wextra','-Werror','-municode'],bits);
for(const bits of [64,32])compile('crypto-'+bits+'-probe.exe','crypto-probe.c',['-Wextra','-Werror','-lncrypt','-lbcrypt'],bits);
const folder=native+'/playfab-folder';await fs.mkdir(folder,{recursive:true});
const definition=(await fs.readFile(project+'/runtime-compat/playfab-save-folder.def','utf8')).replace(/^(PF\w+)(?:=\S+)? @(\d+)$/gm,(_,name,ordinal)=>name+(name==='PFGameSaveFilesInitialize'?'':'=probe_stub')+' @'+ordinal);
try{await fs.writeFile(folder+'/fixture.def',definition,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(folder+'/fixture.def','utf8')!==definition)throw e;}
compile('playfab-folder/nexus_pgs_native.dll','playfab-folder-probe.c',['-shared','-Wextra','-Werror','-DPROBE_SDK',folder+'/fixture.def']);
compile('playfab-folder/xgameruntime.dll','playfab-folder-probe.c',['-shared','-Wextra','-Werror','-DPROBE_RUNTIME']);
compile('playfab-folder/playfab-folder-probe.exe','playfab-folder-probe.c');
await buildPlayFabSessionProbe(native+'/playfab-session',[...include.slice(1),'-I',cpp+'/include','-I',root+'/win64/include']);
const hashes={};
async function inventory(directory){for(const d of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,d.name);if(d.isDirectory())await inventory(file);else if(d.isFile()&&/\.(exe|dll)$/.test(d.name))hashes[path.relative(root,file)]=await fileHash(file);
}}
for(const directory of [root+'/win64/bin',root+'/win32/bin',native])await inventory(directory);
await fs.writeFile(root+'/fixtures.json',JSON.stringify({schema:1,scope:'synthetic test executables only, not distribution components',sdk:built.inputs.sdk,sourceGraph:built.graph,plans,hashes},null,2)+'\n',{flag:'wx'});
