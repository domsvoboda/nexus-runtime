// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {project,readJson,sha256} from './inputs.mjs';
export async function verifyAuxiliary(directory,inputs){
  const bytes=await fs.readFile(path.join(directory,'auxiliary.json')),manifest=JSON.parse(bytes);
  const lockHash=sha256(await fs.readFile(path.join(project,'inputs.lock.json')));
  if(manifest.inputsSha256!==lockHash&&sha256(bytes)!==inputs.verifiedAuxiliaryManifestSha256)throw Error('Auxiliary producer does not match the checked inputs');
  for(const name of ['url','commit','version'])if(manifest.source?.[name]!==inputs.nghttp2[name])throw Error('Wrong nghttp2 source');
  const layouts=[['headers',['nghttp2.h','nghttp2ver.h'],name=>'components/nghttp2/'+name],['libraries',['i386','x86_64'],name=>'components/'+name+'/libnghttp2.dll'],['compatibility',['PlayFabGameSave.dll','gaming-services-version.exe','wine-launcher'],name=>'components/'+name]];
  for(const [group,names,file]of layouts){
    if(Object.keys(manifest[group]||{}).sort().join(',')!==[...names].sort().join(','))throw Error('Wrong auxiliary group: '+group);
    for(const name of names){
      const expected=manifest[group][name];
      if(!/^[a-f0-9]{64}$/.test(expected)||sha256(await fs.readFile(path.join(directory,file(name))))!==expected)throw Error('Auxiliary checksum mismatch: '+name);
    }
  }
  const media=await readJson(path.join(directory,'media/media-manifest.json'));
  const lock=await readJson(path.join(project,'runtime-media.lock.json'));
  if(media.version!==lock.version||media.source!==lock.url||media.sourceSha256!==lock.sha256)throw Error('Media source mismatch');
  if(!/^2\.(?:[0-9]|[12][0-9]|3[0-5])$/.test(media.maxGlibc))throw Error('Unportable media glibc requirement');
  if(Object.keys(media.libraries||{}).sort().join(',')!==Object.keys(lock.libraries).sort().join(','))throw Error('Incomplete media libraries');
  for(const [soname,filename]of Object.entries(lock.libraries)){
    const item=media.libraries[soname];
    if(item.filename!==filename||sha256(await fs.readFile(path.join(directory,'media/stage/usr/lib/x86_64-linux-gnu',filename)))!==item.sha256)throw Error('Media checksum mismatch: '+soname);
  }
  return {manifest,manifestSha256:sha256(bytes),mediaSha256:sha256(await fs.readFile(path.join(directory,'media/media-manifest.json')))};
}
