// Bake a downloaded car model into the canonical form js/gltfcar.js expects: every mesh node at the scene root with its world transform
// applied to the vertices, scaled to <lengthMetres>, rotated about Y so the nose points to +x, centred on x/z, tyres on y=0; OBJ-export
// leftovers cleaned up (all-BLEND materials -> OPAQUE, emissive maps that just duplicate the colour maps removed).
//   npm i @gltf-transform/cli @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf sharp
//   node tools/bake-model.mjs in.gltf baked.glb 4.794 -90        # (rotY degrees: -90 if the nose points to -z, +90 if it points to +z)
//   npx gltf-transform optimize baked.glb out.glb --compress draco --texture-compress webp --texture-size 1024 --simplify false --join false --flatten false --instance false
// usage: node bake-model.mjs in.gltf out.glb <lengthMetres> <rotYdeg>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformMesh, getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
const [,, inp, out, lenS, rotS] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder': await draco3d.createDecoderModule()});
const doc = await io.read(inp);
const root = doc.getRoot(); const scene = root.listScenes()[0];
const th = (+rotS) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
// Ry(th) column-major
const R = [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
const mul = (a,b)=>{const o=new Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;};
// bounds of world scene under R
const wb = getBounds(scene);
let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
for (const x of [wb.min[0],wb.max[0]]) for (const y of [wb.min[1],wb.max[1]]) for (const z of [wb.min[2],wb.max[2]]) {
  const p=[c*x+s*z, y, -s*x+c*z]; for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i]);}
}
const sc = (+lenS) / (mx[0]-mn[0]);
const T = [1,0,0,0, 0,1,0,0, 0,0,1,0, -(mn[0]+mx[0])/2*sc, -mn[1]*sc, -(mn[2]+mx[2])/2*sc, 1];
const S = [sc,0,0,0, 0,sc,0,0, 0,0,sc,0, 0,0,0,1];
const A = mul(T, mul(S, R));
const meshNodes = root.listNodes().filter(n=>n.getMesh());
const uses = new Map(); for (const n of meshNodes) uses.set(n.getMesh(), (uses.get(n.getMesh())||0)+1);
for (const n of meshNodes) {
  let mesh = n.getMesh();
  if (uses.get(mesh) > 1) { mesh = mesh.clone(); n.setMesh(mesh); }
  transformMesh(mesh, mul(A, n.getWorldMatrix()));
}
for (const n of meshNodes) { n.getParentNode()?.removeChild(n); scene.removeChild(n); n.setMatrix([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); scene.addChild(n); }
// drop everything that is not a mesh node at the top level
for (const n of scene.listChildren()) if (!n.getMesh()) { n.listChildren().forEach(ch=>{}); scene.removeChild(n); n.dispose(); }

// ---- material clean-up (OBJ-converted models: everything is BLEND, emissive maps duplicate the colour maps) ----
import sharp from 'sharp';
const keepEmissive = /drl|light|lamp|led/i;
let nOpaque = 0, nEm = 0;
for (const m of root.listMaterials()) {
  if (m.getEmissiveTexture() && !keepEmissive.test(m.getName())) { m.setEmissiveTexture(null); m.setEmissiveFactor([0,0,0]); nEm++; }
  if (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] >= 0.95 && !/opac|glass|window/i.test(m.getName())) {
    const t = m.getBaseColorTexture();
    let realAlpha = false;
    if (t) { const st = await sharp(Buffer.from(t.getImage())).stats(); const ch = st.channels; if (ch.length === 4 && ch[3].min < 240) realAlpha = true; }
    if (!realAlpha) { m.setAlphaMode('OPAQUE'); nOpaque++; }
  }
}
console.log('opaque-ified', nOpaque, 'emissive removed', nEm);
await io.write(out, doc);
const nb = getBounds(scene); console.log('baked scale', sc.toFixed(5), 'bounds', nb.min.map(v=>v.toFixed(3)), nb.max.map(v=>v.toFixed(3)));
