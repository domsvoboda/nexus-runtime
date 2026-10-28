// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {project,repository} from './inputs.mjs';
test('source CI cannot build or publish distribution candidates',()=>{
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/nexus-source.yml'),'utf8');
  assert.match(workflow,/node nexus\/check-source\.mjs/);
  assert.doesNotMatch(workflow,/build-runtime|gh release|upload-artifact|secrets\./);
});
test('candidate build rejects a non-main CI invocation before touching inputs',()=>{
  const result=spawnSync(process.execPath,[path.join(project,'build-runtime.mjs'),'/missing-aux','/missing-work','/missing-output'],{env:{...process.env,GITHUB_REF:'refs/heads/develop'},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Distribution builds are main-only/);
});
test('the real C++ component uses the official CMake rules and same Wine tools',()=>{
  const source=fs.readFileSync(path.join(repository,'Makefile.in'),'utf8');
  assert.match(source,/rules-cmake,xgameruntime,i386,windows/);
  assert.match(source,/rules-cmake,xgameruntime,x86_64,windows/);
  assert.match(source,/-DNEXUS_WINE_BUILTIN=ON/);
  assert.match(source,/-DNEXUS_WINEBUILD="\$\(WINE_\$\(HOST_ARCH\)_OBJ\)\/tools\/winebuild\/winebuild"/);
  assert.match(source,/default_pfx: xgameruntime/);
});
test('ARM64 builds one ARM64X C++ module through the same CMake rules',()=>{
  const source=fs.readFileSync(path.join(repository,'Makefile.in'),'utf8');
  assert.match(source,/rules-cmake,xgameruntime,arm64ec,windows/);
  assert.match(source,/XGAMERUNTIME_arm64ec_CMAKE_ARGS[^#]*-DCMAKE_INSTALL_LIBDIR=lib\/wine\/aarch64-windows/);
  assert.equal((source.match(/ -marm64x"/g)||[]).length,3);
  assert.match(source,/module64: xgameruntime-x86_64-build \$\(if \$\(filter arm64ec-windows,\$\(ARCHS\)\),xgameruntime-arm64ec-build\)/);
});
test('ARM64 candidate build also rejects a non-main CI invocation before touching inputs',()=>{
  const result=spawnSync(process.execPath,[path.join(project,'build-runtime.mjs'),'--arch','arm64','/missing-aux','/missing-work','/missing-output'],{env:{...process.env,GITHUB_REF:'refs/heads/feature/arm64'},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Distribution builds are main-only/);
});
test('ARM64 candidate workflow compiles only on main, including manual dispatch',()=>{
  const text=fs.readFileSync(path.join(repository,'.github/workflows/nexus-runtime-arm64.yml'),'utf8');
  assert.match(text,/^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(text,/pull_request|secrets\.|gh release|contents: write/);
  const jobs=text.slice(text.indexOf('\njobs:\n')).split(/\n  (?=[a-z-]+:\n)/).slice(1);
  assert.equal(jobs.length,(text.match(/^    runs-on: /gm)||[]).length);
  assert.ok(jobs.length>=2);
  for(const job of jobs)assert.match(job,/^[a-z-]+:\n    if: github\.ref == 'refs\/heads\/main'\n/);
  assert.match(text,/node nexus\/build-auxiliary\.mjs --arch arm64 /);
  assert.match(text,/node nexus\/build-runtime\.mjs --arch arm64 /);
  assert.match(text,/runs-on: ubuntu-24\.04-arm/);
});
test('ARM64 workflow supplies the exact llvm-mingw archive and SHA-256',()=>{
  const text=fs.readFileSync(path.join(repository,'.github/workflows/nexus-runtime-arm64.yml'),'utf8');
  assert.match(text,/^  NEXUS_LLVM_MINGW_URL: https:\/\/github\.com\/mstorsjo\/llvm-mingw\/releases\/download\/(\d{8})\/llvm-mingw-\1-ucrt-ubuntu-22\.04-aarch64\.tar\.xz\n/m);
  assert.match(text,/^  NEXUS_LLVM_MINGW_SHA256: [a-f0-9]{64}\n/m);
});
test('ARM64 Proton gives 32-bit exes vector TSO only without the C++ locked-atomics fix',()=>{
  const proton=fs.readFileSync(path.join(repository,'proton'),'utf8').replaceAll('\r\n','\n');
  assert.match(proton,/if len\(sys\.argv\) >= 3 and pe_machine\(sys\.argv\[2\]\) == 0x014c and \\\n +not file_contains\(g_proton\.lib_dir \+ "\/wine\/i386-windows\/xgameruntime\.dll", fex_safe_atomics_marker\):\n +app_config\["Config"\]\["VectorTSOEnabled"\] = "1"/);
  const marker='nexus-fex-safe-i386-atomics-v1';
  assert.ok(proton.includes('fex_safe_atomics_marker = b"'+marker+'"'));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-pe-'));
  const pe=machine=>{const b=Buffer.alloc(0x86);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80,'latin1');b.writeUInt16LE(machine,0x84);return b;};
  for(const [name,data]of [['x86.exe',pe(0x14c)],['x64.exe',pe(0x8664)],['text.exe',Buffer.from('not a PE')],['fixed.dll',Buffer.concat([pe(0x14c),Buffer.from(marker)])]])fs.writeFileSync(path.join(directory,name),data);
  const script="import ast,sys\nm=ast.parse(open(sys.argv[1]).read())\nexec(compile(ast.Module([n for n in m.body if (isinstance(n,ast.FunctionDef) and n.name in ('pe_machine','file_contains')) or (isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='fex_safe_atomics_marker')],[]),'proton','exec'))\nprint([pe_machine(p) for p in sys.argv[2:]],[file_contains(p,fex_safe_atomics_marker) for p in sys.argv[2:]])";
  const result=spawnSync('python3',['-I','-c',script,path.join(repository,'proton'),...['x86.exe','x64.exe','text.exe','missing.exe','fixed.dll'].map(n=>path.join(directory,n))],{encoding:'utf8'});
  fs.rmSync(directory,{recursive:true});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'[332, 34404, None, None, 332] [False, False, False, False, True]');
  const validation=fs.readFileSync(path.join(project,'ci/validate-runtime-arm64.mjs'),'utf8');
  assert.ok(validation.includes("(await fs.readFile(dll)).includes('"+marker+"')"));
  assert.match(validation,/Config:arch==='i386'&&!fexSafeAtomics\?\{VectorTSOEnabled:'1'\}:\{\}/);
  assert.match(validation,/env:\{\.\.\.gateEnv,FEX_APP_CONFIG:appConfigFile\}/);
});
