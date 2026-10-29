// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {project,repository} from '../inputs.mjs';

test('ARM64 packaging requires every original gate plus HTTP/2 and media',()=>{
  const validator=fs.readFileSync(project+'/ci/validate-runtime-arm64.mjs','utf8');
  const packager=fs.readFileSync(project+'/ci/package-runtime-arm64.mjs','utf8');
  assert.ok(packager.includes("['arm64-layout','arm64-prefix-boot','arm64-load-aarch64','arm64-load-x86_64','arm64-load-i386',...['win64','win32'].flatMap(abi=>['component','authentication','user-contracts','store'].map(gate=>abi+'-'+gate)),'arm64-http','arm64-media']"));
  assert.ok(packager.includes('proof.results.length!==gates.length'));
  assert.ok(packager.includes('r.name!==gates[i]||r.status!==0||r.signal||r.error'));
  assert.ok(validator.includes("'--arch','arm64',...args"));
  assert.ok(validator.includes("http.code!==0||http.timedOut||!http.summary.includes('SUMMARY checks=121 failures=0')||!media.h264||!media.aac||!media.bundledLibraries"));
  assert.ok(validator.includes("failedGates.push('arm64-http-drain')"));
  assert.ok(validator.includes('await treeHash(runtime)!==proof.treeSha256'));
  const workflow=fs.readFileSync(repository+'/.github/workflows/nexus-runtime-arm64.yml','utf8');
  for(const input of ['openssl','pkg-config','libgstreamer1.0-dev','libgstreamer-plugins-base1.0-0','runtime-http2-*/*.json','media/results.json'])assert.ok(workflow.includes(input),input);
});

test('HTTP/2 and media reject unsupported architecture before accessing a runtime',()=>{
  for(const script of ['run-http2-suite.mjs','run-media-suite.mjs']){
    const result=spawnSync(process.execPath,[project+'/runtime-tests/'+script,'--arch','invalid','/missing-runtime','/missing-work'],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Unsupported target architecture/);
  }
});
