// SPDX-License-Identifier: MIT
// Account-free investigation only, never a distribution candidate or approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileHash,treeHash,assertPortable} from './provenance.mjs';
import {diagnosticEnvironment,diagnosticProbe} from './thread-diagnostic-tools.mjs';
if(process.arch!=='arm64'||process.argv.length!==3)throw Error('Native ARM64 and NEW_WORK_DIRECTORY required');
const work=path.resolve(process.argv[2]);await fs.mkdir(work,{recursive:false,mode:0o700});
const pins={
  engine:{url:'https://nightly.link/indiesaudi/nexus-runtime/actions/runs/40840830196/nexus-runtime-arm64.zip',sha256:'f4f8c4a1f05a0dca4af3bc463a580f5891d9bfd8a0d66595c411964586c02415',commit:'6b03f0d9f2af39914df60d9a25f8c822936ccf2b'},
  fixture:{url:'https://nightly.link/domsvoboda/nexus-runtime/suites/110707820194/artifacts/12888484537',sha256:'c4fb26f968bd2076eb62fe518e67aedc471c8d065fc9a88c259cbb8608086a96',commit:'9ffa2a4c94bddabad8a89302480ed7ff9c4995bc'},
};
async function download(pin,file){
  execFileSync('curl',['--proto','=https','--proto-redir','=https','--tlsv1.2','--fail','--location','--silent','--show-error','--connect-timeout','15','--max-time','180','--output',file,pin.url],{stdio:'inherit',timeout:190000});
  if(await fileHash(file)!==pin.sha256)throw Error('Diagnostic download checksum mismatch');
}
await download(pins.engine,work+'/engine.zip');await download(pins.fixture,work+'/fixture.zip');
const zipNames=execFileSync('unzip',['-Z1',work+'/engine.zip'],{encoding:'utf8'}).trim().split('\n');
if(zipNames.some(name=>name.includes('/')||name.includes('..')))throw Error('Unexpected diagnostic artifact layout');
const binary='nexus-runtime-11.0-experimental-arm64-g6b03f0d9-aarch64.tar.xz';
if(!zipNames.includes(binary)||!zipNames.includes('candidate.json'))throw Error('Missing diagnostic engine');
await fs.mkdir(work+'/engine-input');execFileSync('unzip',['-q',work+'/engine.zip','candidate.json',binary,'-d',work+'/engine-input']);
const manifest=JSON.parse(await fs.readFile(work+'/engine-input/candidate.json','utf8'));
if(manifest.commit!==pins.engine.commit||manifest.repository!=='indiesaudi/nexus-runtime'||manifest.arch!=='arm64'||manifest.promotable!==false||manifest.validation.nativeGateCount!==16||manifest.validation.stableApproved!==false)throw Error('Not the pinned non-promotable diagnostic engine');
if(manifest.sourceGraph.wine!=='9529a9fcd3cc8d2101fa44de604c2ac01c452993'||manifest.sourceGraph.xgameruntime!=='5539e7d23d2d2c49f8547c9b9721fb7bc59139c1')throw Error('Diagnostic dependency graph differs');
if(!manifest.sourceGraph.submodules.some(line=>line.startsWith(' 5285020de0b30dbdae7b44d0d83541af2d13d002 FEX ')))throw Error('Diagnostic FEX pin differs');
const inputs=JSON.parse(await fs.readFile(new URL('../inputs.lock.json',import.meta.url),'utf8'));
if(manifest.sdk!==inputs.sdkArm64)throw Error('Diagnostic SDK differs');
if(await fileHash(work+'/engine-input/'+binary)!==manifest.files.find(item=>item.name===binary)?.sha256)throw Error('Changed engine tarball');
const top=binary.replace('-aarch64.tar.xz',''),names=execFileSync('tar',['-tJf',work+'/engine-input/'+binary],{encoding:'utf8',maxBuffer:64*1024*1024}).trim().split('\n');
if(names.some(name=>path.isAbsolute(name)||name.split('/').includes('..')||name.split('/')[0]!==top))throw Error('Unsafe engine archive');
await fs.mkdir(work+'/engine');execFileSync('tar',['-xJf',work+'/engine-input/'+binary,'--same-permissions','-C',work+'/engine']);
const runtime=work+'/engine/'+top,files=runtime+'/files';await assertPortable(runtime);
if(await treeHash(runtime)!==manifest.validation.treeSha256)throw Error('Diagnostic runtime differs from validated bytes');
await fs.mkdir(work+'/probes');
const probes=[['device32','win32','nexus_user-device-association.exe','6c978f3a6e1d1df7d0ebe995ce373f116d8e9b6159bb15eabffc0135101bd00f'],['close64','win64','nexus_taskqueue-close.exe','d8d29d64fe8e85ce7d687ca704a282f5c4c269c315001196b0c348f772ea1fd5']];
for(const [,abi,name,hash]of probes){
  const bytes=execFileSync('unzip',['-p',work+'/fixture.zip','nexus-fixtures/'+abi+'/bin/'+name],{maxBuffer:32*1024*1024});
  await fs.writeFile(work+'/probes/'+name,bytes,{flag:'wx'});
  if(await fileHash(work+'/probes/'+name)!==hash)throw Error('Wrong exact test fixture');
}
await fs.mkdir(work+'/home',{mode:0o700});await fs.cp(files+'/share/fex-emu',work+'/fex',{recursive:true,errorOnExist:true,force:false});
const builtin=/\/lib\/wine\/(?:i386|x86_64|aarch64)-(?:unix|windows)$/;
async function seed(source,destination){
  await fs.mkdir(destination);
  for(const entry of await fs.readdir(source,{withFileTypes:true})){
    const from=source+'/'+entry.name,to=destination+'/'+entry.name;
    if(entry.isDirectory())await seed(from,to);
    else if(entry.isSymbolicLink()){
      const value=await fs.readlink(from);await fs.symlink(builtin.test(path.dirname(value))?path.resolve(source,value):value,to);
    }else await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);
  }
}
await seed(files+'/share/default_pfx_arm64',work+'/pfx');await fs.mkdir(work+'/pfx/dosdevices',{recursive:true});
for(const [drive,target]of [['c:','../drive_c'],['z:','/']])try{await fs.symlink(target,work+'/pfx/dosdevices/'+drive);}catch(error){if(error.code!=='EEXIST')throw error;}
const env=diagnosticEnvironment(files,work),wine=files+'/bin-arm64/wine',server=files+'/bin-arm64/wineserver';
const report={schema:1,scope:'diagnostic only, different Proton revision with identical pinned Wine/XGameRuntime/FEX; not candidate approval',realGameTest:false,realAccountTest:false,realCloudTest:false,promotable:false,stableApproved:false,pins,engineGraph:manifest.sourceGraph,results:[]};
try{
  const boot=spawnSync(wine,['wineboot','-u'],{env,cwd:work,encoding:'utf8',timeout:60000});
  await fs.writeFile(work+'/boot.log',(boot.stdout||'')+(boot.stderr||''),{flag:'wx'});
  if(boot.status!==0||boot.error||boot.signal)throw Error('Private diagnostic prefix failed to boot');
  for(const [label,,name]of probes)for(let trial=0;trial<4;trial++){
    const stem=label+'-'+trial;
    const result=await diagnosticProbe(wine,[work+'/probes/'+name],{env,cwd:work+'/probes',log:work+'/'+stem+'.log',debugLog:work+'/'+stem+'-gdb.txt'});
    report.results.push({label,trial,...result,logSha256:await fileHash(work+'/'+stem+'.log')});
    console.log(JSON.stringify({label,trial,...result}));
    if(result.debugged||result.code!==0)break;
  }
  if(await treeHash(runtime)!==manifest.validation.treeSha256)throw Error('Diagnostic engine changed');
}finally{
  spawnSync(server,['-k'],{env,timeout:10000,stdio:'ignore'});spawnSync(server,['-w'],{env,timeout:10000,stdio:'ignore'});
  await fs.writeFile(work+'/results.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
// A reproduced failure is useful evidence, not a successful compatibility test.
if(report.results.some(result=>result.code!==0||result.signal||result.timedOut))process.exitCode=1;
