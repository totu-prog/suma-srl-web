import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const PRODUCTS = {
  beam:  { L: 200, W: 12,  H: 12 },
  chair: { L: 45,  W: 45,  H: 85 },
  panel: { L: 250, W: 120, H: 2  },
  plank: { L: 200, W: 14,  H: 2  }
};

const WOOD_TONES = [
  { base: '#8a6232', dark: '#4a2c10', light: '#a98256' }, // oak / abete chiaro
  { base: '#7a4a22', dark: '#3a1f08', light: '#9c6a3a' }, // noce
  { base: '#9a7a4e', dark: '#5a3a1c', light: '#b89b6f' }, // faggio chiaro
  { base: '#6b4626', dark: '#2e1c0c', light: '#8a6336' }  // teak
];

let renderer, scene, camera, controls, currentGroup, container, pmremGenerator;
let visibleInView = true;

/* ---------- helpers ---------- */

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}
function mix(a, b, t) { return a + (b - a) * t; }

// Simple value-noise (cheap, deterministic enough for grain)
function makeNoise(seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return rnd;
}

function makeWoodTextures(toneIdx, repeatU = 2, repeatV = 1) {
  const tone = WOOD_TONES[toneIdx % WOOD_TONES.length];
  const W = 1024, H = 1024;

  const col = document.createElement('canvas');
  col.width = W; col.height = H;
  const cctx = col.getContext('2d');

  const nrm = document.createElement('canvas');
  nrm.width = W; nrm.height = H;
  const nctx = nrm.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rctx = rgh.getContext('2d');

  const baseRGB = hexToRgb(tone.base);
  const darkRGB = hexToRgb(tone.dark);
  const lightRGB = hexToRgb(tone.light);

  const cImg = cctx.createImageData(W, H);
  const nImg = nctx.createImageData(W, H);
  const rImg = rctx.createImageData(W, H);

  const rnd = makeNoise(toneIdx * 7 + 11);
  // pre-generate per-row noise offsets so grain stays continuous along x
  const rowOffsets = new Float32Array(H);
  for (let y = 0; y < H; y++) rowOffsets[y] = (rnd() - 0.5) * 6;

  // grain frequency in y
  const grainFreq = 0.012 + rnd() * 0.006;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;

      // Soft horizontal grain bands using sinusoids + tiny noise
      const wave = Math.sin((y + rowOffsets[y] + Math.sin(x * 0.004) * 18) * grainFreq);
      const bandPos = 0.5 + 0.5 * wave;             // 0..1
      const grainDarkness = Math.pow(bandPos, 6);   // sharpen the dark lines
      const fineNoise = ((Math.sin(x * 0.31 + y * 0.13) + 1) * 0.5) * 0.04;

      // overall lightness modulation (long-period horizontal stripes)
      const macro = 0.5 + 0.5 * Math.sin(y * 0.0012 + Math.sin(x * 0.0008) * 1.5);
      const lighten = macro * 0.35;

      // base colour mixed toward light
      let r = mix(baseRGB[0], lightRGB[0], lighten);
      let g = mix(baseRGB[1], lightRGB[1], lighten);
      let b = mix(baseRGB[2], lightRGB[2], lighten);

      // dark grain line
      r = mix(r, darkRGB[0], grainDarkness * 0.75);
      g = mix(g, darkRGB[1], grainDarkness * 0.75);
      b = mix(b, darkRGB[2], grainDarkness * 0.75);

      // micro noise
      r = Math.max(0, Math.min(255, r + (fineNoise - 0.02) * 60));
      g = Math.max(0, Math.min(255, g + (fineNoise - 0.02) * 60));
      b = Math.max(0, Math.min(255, b + (fineNoise - 0.02) * 60));

      cImg.data[i]   = r;
      cImg.data[i+1] = g;
      cImg.data[i+2] = b;
      cImg.data[i+3] = 255;

      // Normal map: derive from grain darkness (dark lines = small valleys)
      // tangent-space normal encoded as RGB
      const h = 1 - grainDarkness * 0.6;
      // approximate gradient
      const dy = -wave * 0.5;
      const dx = Math.cos(x * 0.004) * 0.05;
      const nx = -dx * 1.5;
      const ny = -dy * 0.8;
      const nz = Math.sqrt(Math.max(0.0001, 1 - nx*nx - ny*ny));
      nImg.data[i]   = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[i+1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[i+2] = Math.round((nz * 0.5 + 0.5) * 255);
      nImg.data[i+3] = 255;

      // Roughness: dark grain = slightly more matte
      const rough = 0.55 + grainDarkness * 0.25 + (1 - macro) * 0.08;
      const rv = Math.round(Math.min(1, rough) * 255);
      rImg.data[i] = rv; rImg.data[i+1] = rv; rImg.data[i+2] = rv; rImg.data[i+3] = 255;
    }
  }

  cctx.putImageData(cImg, 0, 0);
  nctx.putImageData(nImg, 0, 0);
  rctx.putImageData(rImg, 0, 0);

  // Add a few subtle knots
  const knotCount = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < knotCount; k++) {
    const kx = rnd() * W, ky = rnd() * H;
    const kr = 6 + rnd() * 14;
    const rg = cctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
    rg.addColorStop(0, `rgba(${darkRGB[0]*0.6|0},${darkRGB[1]*0.6|0},${darkRGB[2]*0.6|0},0.85)`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    cctx.fillStyle = rg;
    cctx.beginPath(); cctx.arc(kx, ky, kr, 0, Math.PI*2); cctx.fill();
  }

  const make = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatU, repeatV);
    t.anisotropy = 16;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return {
    map: make(col, true),
    normalMap: make(nrm, false),
    roughnessMap: make(rgh, false)
  };
}

function woodMaterial(toneIdx, repeatU = 2, repeatV = 1) {
  const { map, normalMap, roughnessMap } = makeWoodTextures(toneIdx, repeatU, repeatV);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.55
  });
}

/* ---------- dimension labels ---------- */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(14,14,12,0.82)';
  roundRect(ctx, 6, 24, c.width-12, 80, 28); ctx.fill();
  ctx.strokeStyle = '#c8a36a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f4efe6';
  ctx.font = '600 42px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width/2, c.height/2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(55, 14, 1);
  sp.renderOrder = 999;
  return sp;
}

function dimLine(from, to, label) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xc8a36a, transparent: true, opacity: 0.7 });
  const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
  group.add(new THREE.Line(geom, mat));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const sp = makeLabelSprite(label);
  sp.position.copy(mid);
  group.add(sp);
  return group;
}

function addDims(group, L, W, H) {
  const pad = Math.max(L, W, H) * 0.12 + 6;
  group.add(dimLine(
    new THREE.Vector3(-L/2, -H/2 - pad, W/2 + pad/2),
    new THREE.Vector3( L/2, -H/2 - pad, W/2 + pad/2),
    `L ${L} cm`
  ));
  group.add(dimLine(
    new THREE.Vector3( L/2 + pad/2, -H/2 - pad, -W/2),
    new THREE.Vector3( L/2 + pad/2, -H/2 - pad,  W/2),
    `W ${W} cm`
  ));
  group.add(dimLine(
    new THREE.Vector3(-L/2 - pad/2, -H/2, W/2 + pad/2),
    new THREE.Vector3(-L/2 - pad/2,  H/2, W/2 + pad/2),
    `H ${H} cm`
  ));
}

/* ---------- product builders ---------- */

function chamferedBox(L, H, W, bevel = 0.4) {
  // BoxGeometry with subtle chamfer via slight inset using BoxGeometry segments isn't real,
  // but we can fake softer edges visually with a tiny ExtrudeGeometry. For perf keep BoxGeometry
  // and rely on normalMap to break edge harshness.
  return new THREE.BoxGeometry(L, H, W);
}

function buildBeam() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.beam;
  const mat = woodMaterial(0, 6, 1);
  const mesh = new THREE.Mesh(chamferedBox(L, H, W), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  addDims(g, L, W, H);
  return g;
}

function buildChair() {
  const g = new THREE.Group();
  const seatW = 45, seatD = 45, seatT = 4;
  const legT = 4, legH = 45;
  const backH = 40, backT = 3;
  const mat = woodMaterial(1, 2, 2);

  const meshes = [];
  const seat = new THREE.Mesh(chamferedBox(seatW, seatT, seatD), mat);
  seat.position.y = legH + seatT/2;
  meshes.push(seat);

  const legPos = [
    [-seatW/2+legT/2, legH/2,  seatD/2-legT/2],
    [ seatW/2-legT/2, legH/2,  seatD/2-legT/2],
    [-seatW/2+legT/2, legH/2, -seatD/2+legT/2],
    [ seatW/2-legT/2, legH/2, -seatD/2+legT/2]
  ];
  for (const [x,y,z] of legPos) {
    const leg = new THREE.Mesh(chamferedBox(legT, legH, legT), mat);
    leg.position.set(x, y, z);
    meshes.push(leg);
  }
  for (const [x,,z] of [legPos[2], legPos[3]]) {
    const post = new THREE.Mesh(chamferedBox(legT, backH, legT), mat);
    post.position.set(x, legH + seatT + backH/2, z);
    meshes.push(post);
  }
  const back = new THREE.Mesh(chamferedBox(seatW, backH*0.6, backT), mat);
  back.position.set(0, legH + seatT + backH*0.6, -seatD/2 + backT/2);
  meshes.push(back);

  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; g.add(m); }

  g.position.y = -(legH + seatT + backH) / 2;
  // dimension overlay around the bounding box
  addDims(g, seatW, seatD, legH + seatT + backH);
  return g;
}

function buildPanel() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.panel;
  const mat = woodMaterial(2, 6, 3);
  const mesh = new THREE.Mesh(chamferedBox(L, H, W), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  addDims(g, L, W, H);
  return g;
}

function buildPlank() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.plank;
  const mat = woodMaterial(3, 8, 1);
  const main = new THREE.Mesh(chamferedBox(L, H, W), mat);
  main.castShadow = true; main.receiveShadow = true;
  g.add(main);
  // tongue
  const tongue = new THREE.Mesh(chamferedBox(L, H*0.5, W*0.12), mat);
  tongue.position.set(0, 0, W/2 + W*0.06);
  tongue.castShadow = true; tongue.receiveShadow = true;
  g.add(tongue);
  // groove (slightly recessed darker box)
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x1f1409, roughness: 1, metalness: 0 });
  const groove = new THREE.Mesh(new THREE.BoxGeometry(L*0.995, H*0.55, W*0.13), grooveMat);
  groove.position.set(0, 0, -W/2 - W*0.065);
  g.add(groove);
  addDims(g, L, W, H);
  return g;
}

function builderFor(kind) {
  switch (kind) {
    case 'beam':  return buildBeam();
    case 'chair': return buildChair();
    case 'panel': return buildPanel();
    case 'plank': return buildPlank();
  }
  return buildBeam();
}

function frameCamera(kind) {
  const { L, W, H } = PRODUCTS[kind];
  const maxDim = Math.max(L, W, H);
  const dist = maxDim * 1.9 + 60;
  camera.position.set(dist * 0.7, dist * 0.55, dist * 0.9);
  controls.target.set(0, 0, 0);
  camera.near = 1;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  controls.update();
}

/* ---------- init / loop ---------- */

export function initViewer(mountEl) {
  container = mountEl;
  const { clientWidth: w, clientHeight: h } = container;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(35, w / h, 1, 5000);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // environment for subtle PBR reflections
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  // lights
  const hemi = new THREE.HemisphereLight(0xfff0d6, 0x1a140a, 0.35);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1d4, 1.6);
  key.position.set(160, 240, 180);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -350;
  key.shadow.camera.right = 350;
  key.shadow.camera.top = 350;
  key.shadow.camera.bottom = -350;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 800;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.4;
  key.shadow.radius = 4;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xa6b8c8, 0.35);
  fill.position.set(-180, 120, -40);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xc8a36a, 0.45);
  rim.position.set(-120, 60, -220);
  scene.add(rim);

  // floor with subtle texture
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x14110c,
    roughness: 0.92,
    metalness: 0.0
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(800, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -120;
  floor.receiveShadow = true;
  scene.add(floor);

  // very subtle fog for depth
  scene.fog = new THREE.Fog(0x0e0e0c, 800, 2400);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 30;
  controls.maxDistance = 1400;
  controls.maxPolarAngle = Math.PI * 0.52;

  swapProduct('beam');

  window.addEventListener('resize', onResize);
  const io = new IntersectionObserver(entries => {
    visibleInView = entries[0].isIntersecting;
  }, { threshold: 0.05 });
  io.observe(container);

  animate();
}

export function swapProduct(kind) {
  if (!scene) return;
  if (currentGroup) {
    scene.remove(currentGroup);
    currentGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        ['map','normalMap','roughnessMap'].forEach(k => o.material[k] && o.material[k].dispose());
        o.material.dispose();
      }
    });
  }
  currentGroup = builderFor(kind);
  scene.add(currentGroup);
  frameCamera(kind);
}

function onResize() {
  if (!renderer || !container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!visibleInView) return;
  controls.update();
  if (currentGroup) currentGroup.rotation.y += 0.0008;  // slower, more cinematic
  renderer.render(scene, camera);
}

export { PRODUCTS };
