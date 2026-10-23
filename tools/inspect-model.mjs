// node tools/inspect-model.mjs model.glb   — prints every mesh node with its tris, world bbox and material (needs the npm deps listed in bake-model.mjs)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder': await draco3d.createDecoderModule()});
const doc = await io.read(process.argv[2]);
const scene = doc.getRoot().listScenes()[0];
const sb = getBounds(scene);
console.log('scene bounds', sb.min.map(v=>v.toFixed(2)), sb.max.map(v=>v.toFixed(2)));
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  const b = getBounds(n);
  let tris=0; for (const p of m.listPrimitives()) tris += p.getIndices()?.getCount()/3 || 0;
  const mats = m.listPrimitives().map(p=>p.getMaterial()?.getName()).join(',');
  const mat = m.listPrimitives()[0].getMaterial();
  console.log(n.getName().padEnd(12), String(tris).padStart(6), 'min', b.min.map(v=>v.toFixed(2)).join(','), 'max', b.max.map(v=>v.toFixed(2)).join(','), mats.slice(0,40), mat? mat.getBaseColorFactor().map(v=>v.toFixed(2)).join('/') + (mat.getBaseColorTexture()?' tex':'')+' a'+mat.getAlphaMode():'');
}
