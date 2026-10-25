// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {project,repository,run,readJson,sha256,verifyInputs,verifySourceGraph} from './inputs.mjs';
import {verifyAuxiliary} from './auxiliary.mjs';
import {sdkContainerOption,sdkBuildJobs,sdkBuildPlan,verifySdkResumeMakefile} from './sdk-build-plan.mjs';
import {assembleRuntime} from './assemble-runtime.mjs';
const [auxArg,workArg,outputArg,resumeArg]=process.argv.slice(2);
if(!auxArg||!workArg||!outputArg||process.argv.length>6||resumeArg&&resumeArg!=='--resume')throw Error('Usage: build-runtime.mjs AUXILIARY NEW_WORK NEW_OUTPUT [--resume]');
if(process.env.GITHUB_REF&&process.env.GITHUB_REF!=='refs/heads/main')throw Error('Distribution builds are main-only');
const aux=await fs.realpath(auxArg),work=path.resolve(workArg),output=path.resolve(outputArg),resume=resumeArg==='--resume';
const {inputs}=await verifyInputs(),lockHash=sha256(await fs.readFile(path.join(project,'inputs.lock.json')));
const verifiedAux=await verifyAuxiliary(aux,inputs),auxiliary=verifiedAux.manifest;
const engine=sdkContainerOption(process.env.NEXUS_CONTAINER_ENGINE).split('=')[1],jobs=sdkBuildJobs(process.env.NEXUS_BUILD_JOBS);
const source=repository,wine=path.join(source,'wine'),shader=path.join(source,'vkd3d');
const stateFile=path.join(work,'prepared.json'),build=path.join(work,'sdk-build');
let graph,name,epoch;
if(!resume){
  ({graph}=await verifySourceGraph({full:true,main:true}));
  await fs.mkdir(work,{recursive:false});
  name='nexus-runtime-11.0-experimental-g'+graph.proton.slice(0,8);
  epoch=run('git',['log','-1','--format=%ct'],source,{capture:true}).trim();
  const configure=await fs.readFile(path.join(shader,'configure.ac'),'utf8');
  if(!configure.includes('[vkd3d], ['+inputs.shader.version+']'))throw Error('Pinned shader source version mismatch');
  run('git',['apply','--check',path.join(project,inputs.shader.file)],shader);
  run('git',['apply',path.join(project,inputs.shader.file)],shader);
  await fs.mkdir(path.join(wine,'include/nghttp2'));
  for(const header of Object.keys(auxiliary.headers))await fs.copyFile(path.join(aux,'components/nghttp2',header),path.join(wine,'include/nghttp2',header),fs.constants.COPYFILE_EXCL);
  await fs.mkdir(build);
  run(path.join(source,'configure.sh'),['--build-name='+name,'--container-engine='+engine,'--proton-sdk-image='+inputs.sdk,'--enable-ccache'],build);
  await fs.writeFile(stateFile,JSON.stringify({schema:1,graph,name,epoch,engine,source,inputsSha256:lockHash,...verifiedAux},null,2)+'\n',{flag:'wx'});
}else{
  const state=await readJson(stateFile);
  ({graph,name,epoch}=state);
  if(state.schema!==1||state.source!==source||state.engine!==engine||state.inputsSha256!==lockHash||state.manifestSha256!==verifiedAux.manifestSha256||state.mediaSha256!==verifiedAux.mediaSha256)throw Error('Resume input mismatch');
  if(run('git',['rev-parse','HEAD'],source,{capture:true}).trim()!==graph.proton||run('git',['rev-parse','refs/remotes/origin/main'],source,{capture:true}).trim()!==graph.proton)throw Error('Resume requires the exact selected main source');
  verifySdkResumeMakefile(await fs.readFile(path.join(build,'Makefile'),'utf8'),{source,name,sdk:inputs.sdk,engine});
}
// Reject edits even on resume. The one checked shader patch and the two
// checksum-verified nghttp2 headers are the only prepared source differences.
for(const [directory,expected]of [[source,graph.proton],[wine,graph.wine],[path.join(wine,'dlls/xgameruntime'),graph.xgameruntime]]){
  if(run('git',['rev-parse','HEAD'],directory,{capture:true}).trim()!==expected||run('git',['diff','--ignore-submodules=all','HEAD'],directory,{capture:true}).trim())throw Error('Prepared fork source changed');
}
for(const [module,expected]of Object.entries(graph.modules))if(run('git',['rev-parse','HEAD'],path.join(source,module),{capture:true}).trim()!==expected)throw Error('Prepared graphics source changed');
const changed=run('git',['diff','--name-only','HEAD'],shader,{capture:true}).trim().split('\n').filter(Boolean).sort();
if(changed.join(',')!==Object.keys(inputs.shader.expectedSources).sort().join(','))throw Error('Unexpected shader changes');
for(const [file,expected]of Object.entries(inputs.shader.expectedSources))if(sha256(await fs.readFile(path.join(shader,file)))!==expected)throw Error('Shader source checksum mismatch');
for(const [file,expected]of Object.entries(auxiliary.headers))if(sha256(await fs.readFile(path.join(wine,'include/nghttp2',file)))!==expected)throw Error('Prepared HTTP header mismatch');
try{await fs.lstat(output);throw Error('Output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
const redist=path.join(build,'redist-'+graph.proton.slice(0,8));
for(const stage of sdkBuildPlan(build,epoch,jobs,redist)){console.log(stage.name);run('make',stage.args,build,{timeout:stage.timeout});}
await verifyAuxiliary(aux,inputs);
await assembleRuntime({work,build,redist,source,wine,aux,output,name,inputs,graph,auxiliary,lockHash});
