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
