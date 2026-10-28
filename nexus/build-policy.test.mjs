// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
