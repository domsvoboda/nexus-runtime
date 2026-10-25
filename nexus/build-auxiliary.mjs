// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {project,run,checkout,verifyInputs,sha256} from './inputs.mjs';
import {buildCompatibility} from './runtime-compat/build.mjs';
const [flag,directory]=process.argv.slice(2);
if(flag!=='--work'||!directory||process.argv.length!==4)throw Error('Usage: build-auxiliary.mjs --work NEW_DIRECTORY');
const work=path.resolve(directory),{inputs}=await verifyInputs();
await fs.mkdir(work,{recursive:false});
const source=path.join(work,'nghttp2-src');
await checkout(inputs.nghttp2,source);
const components=path.join(work,'components');
const compatibility=await buildCompatibility(components);
const libraries={};
for(const [arch,target] of [['x86_64','x86_64-w64-mingw32'],['i386','i686-w64-mingw32']]){
  const build=path.join(work,'nghttp2-'+arch);
  run('cmake',['-S',source,'-B',build,'-DCMAKE_SYSTEM_NAME=Windows',`-DCMAKE_C_COMPILER=${target}-gcc`,`-DCMAKE_RC_COMPILER=${target}-windres`,'-DENABLE_LIB_ONLY=ON','-DBUILD_SHARED_LIBS=ON','-DBUILD_STATIC_LIBS=OFF','-DENABLE_DOC=OFF','-DENABLE_APP=OFF','-DENABLE_EXAMPLES=OFF','-DENABLE_FAILMALLOC=OFF','-DBUILD_TESTING=OFF','-DCMAKE_SHARED_LINKER_FLAGS=-static-libgcc'],work);
  run('cmake',['--build',build,'--parallel','4'],work);
  const output=path.join(components,arch);await fs.mkdir(output);
  const file=path.join(output,'libnghttp2.dll');
  await fs.copyFile(path.join(build,'lib/libnghttp2.dll'),file);
  libraries[arch]=sha256(await fs.readFile(file));
}
const headers=path.join(components,'nghttp2');await fs.mkdir(headers);
await fs.copyFile(path.join(source,'lib/includes/nghttp2/nghttp2.h'),path.join(headers,'nghttp2.h'));
await fs.copyFile(path.join(work,'nghttp2-x86_64/lib/includes/nghttp2/nghttp2ver.h'),path.join(headers,'nghttp2ver.h'));
await fs.copyFile(path.join(source,'COPYING'),path.join(components,'nghttp2-LICENSE'));
const headerHashes={};for(const name of ['nghttp2.h','nghttp2ver.h'])headerHashes[name]=sha256(await fs.readFile(path.join(headers,name)));
await fs.writeFile(path.join(work,'auxiliary.json'),JSON.stringify({schema:1,inputsSha256:sha256(await fs.readFile(path.join(project,"inputs.lock.json"))),source:inputs.nghttp2,compatibility,libraries,headers:headerHashes},null,2)+'\n',{flag:'wx'});
run('node',[path.join(project,'build-runtime-media.mjs'),'--work',path.join(work,'media'),'--jobs','4'],project);
run('node',[path.join(project,'ci/check-media-glibc.mjs'),path.join(work,'media/media-manifest.json')],project);
