import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PRODUCTS = {
  beam:  { L: 200, W: 12,  H: 12 },
  chair: { L: 45,  W: 45,  H: 85 },
  panel: { L: 250, W: 120, H: 2  },
  plank: { L: 200, W: 14,  H: 2  }
};

let renderer, scene, camera, controls, currentGroup, container;
let animating = true;
let visibleInView = true;

function makeWoodTexture(tone = 0) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d');

  const baseHues = [
    ['#7a4f29', '#5a3818'],
    ['#8a6a3c', '#604226'],
    ['#9b7a4d', '#6a4a26'],
    ['#7c5732', '#4b2f15']
  ];
  const [hi, lo] = baseHues[tone % baseHues.length];
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, hi);
  g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  // grain lines
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * c.height;
    const amp = 6 + Math.random() * 14;
    const freq = 0.004 + Math.random() * 0.006;
    ctx.strokeStyle = `rgba(${20 + Math.random()*30},${10 + Math.random()*20},0,${0.25 + Math.random()*0.4})`;
    ctx.lineWidth = 0.8 + Math.random() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= c.width; x += 4) {
      const yy = y + Math.sin(x * freq + i) * amp + (Math.random()-0.5)*1.5;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // knots
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const r = 8 + Math.random() * 18;
    const rg = ctx.createRadialGradient(x, y, 1, x, y, r);
    rg.addColorStop(0, '#2a1606');
    rg.addColorStop(1, 'rgba(40,20,5,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function woodMaterial(tone = 0, repeatU = 1, repeatV = 1) {
  const map = makeWoodTexture(tone);
  map.repeat.set(repeatU, repeatV);
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.78,
    metalness: 0.02
  });
}

function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(14,14,12,0.85)';
  const r = 28;
  roundRect(ctx, 6, 24, c.width-12, 80, r);
  ctx.fill();
  ctx.strokeStyle = '#c8a36a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f4efe6';
  ctx.font = '600 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width/2, c.height/2 + 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(60, 15, 1);
  sp.renderOrder = 999;
  return sp;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function dimLine(from, to, label) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xc8a36a, transparent: true, opacity: 0.85 });
  const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geom, mat);
  group.add(line);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const sp = makeLabelSprite(label);
  sp.position.copy(mid);
  group.add(sp);
  return group;
}

function buildBeam() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.beam;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), woodMaterial(0, 4, 1));
  mesh.castShadow = mesh.receiveShadow = true;
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

  const seat = new THREE.Mesh(new THREE.BoxGeometry(seatW, seatT, seatD), mat);
  seat.position.y = legH + seatT/2;
  g.add(seat);

  const legPos = [
    [-seatW/2+legT/2, legH/2,  seatD/2-legT/2],
    [ seatW/2-legT/2, legH/2,  seatD/2-legT/2],
    [-seatW/2+legT/2, legH/2, -seatD/2+legT/2],
    [ seatW/2-legT/2, legH/2, -seatD/2+legT/2]
  ];
  for (const [x,y,z] of legPos) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(legT, legH, legT), mat);
    leg.position.set(x, y, z);
    g.add(leg);
  }
  // back posts continue up
  for (const [x,,z] of [legPos[2], legPos[3]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(legT, backH, legT), mat);
    post.position.set(x, legH + seatT + backH/2, z);
    g.add(post);
  }
  // back panel
  const back = new THREE.Mesh(new THREE.BoxGeometry(seatW, backH*0.6, backT), mat);
  back.position.set(0, legH + seatT + backH*0.6, -seatD/2 + backT/2);
  g.add(back);

  // center the chair on origin (bounding height 85)
  g.position.y = -(legH + seatT + backH) / 2;
  addDims(g, seatW, seatD, legH + seatT + backH, /*offsetY*/ (legH + seatT + backH)/2);
  return g;
}

function buildPanel() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.panel;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), woodMaterial(2, 5, 3));
  g.add(mesh);
  addDims(g, L, W, H);
  return g;
}

function buildPlank() {
  const g = new THREE.Group();
  const { L, W, H } = PRODUCTS.plank;
  const main = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), woodMaterial(3, 6, 1));
  g.add(main);
  // tongue on one long side
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(L, H*0.5, W*0.12), woodMaterial(3, 6, 1));
  tongue.position.set(0, 0, W/2 + W*0.06);
  g.add(tongue);
  // groove visualisation (small darker inset)
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x2a1d10, roughness: 1 });
  const groove = new THREE.Mesh(new THREE.BoxGeometry(L*0.995, H*0.55, W*0.13), grooveMat);
  groove.position.set(0, 0, -W/2 - W*0.065);
  g.add(groove);
  addDims(g, L, W, H);
  return g;
}

function addDims(group, L, W, H, offsetY = 0) {
  const pad = Math.max(L, W, H) * 0.12 + 6;
  // length (x)
  group.add(dimLine(
    new THREE.Vector3(-L/2, -H/2 - pad, W/2 + pad/2),
    new THREE.Vector3( L/2, -H/2 - pad, W/2 + pad/2),
    `L ${L} cm`
  ));
  // width (z)
  group.add(dimLine(
    new THREE.Vector3( L/2 + pad/2, -H/2 - pad, -W/2),
    new THREE.Vector3( L/2 + pad/2, -H/2 - pad,  W/2),
    `W ${W} cm`
  ));
  // height (y)
  group.add(dimLine(
    new THREE.Vector3(-L/2 - pad/2, -H/2, W/2 + pad/2),
    new THREE.Vector3(-L/2 - pad/2,  H/2, W/2 + pad/2),
    `H ${H} cm`
  ));
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

export function initViewer(mountEl) {
  container = mountEl;
  const { clientWidth: w, clientHeight: h } = container;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(38, w / h, 1, 5000);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // lights
  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x1a140a, 0.7);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffe6bf, 1.2);
  dir.position.set(120, 200, 160);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -300;
  dir.shadow.camera.right = 300;
  dir.shadow.camera.top = 300;
  dir.shadow.camera.bottom = -300;
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0xc8a36a, 0.35);
  rim.position.set(-200, 80, -120);
  scene.add(rim);

  // floor
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64),
    new THREE.MeshStandardMaterial({ color: 0x14110c, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -120;
  floor.receiveShadow = true;
  scene.add(floor);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 30;
  controls.maxDistance = 1200;
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
        if (o.material.map) o.material.map.dispose();
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
  if (currentGroup) currentGroup.rotation.y += 0.0015;
  renderer.render(scene, camera);
}

export { PRODUCTS };
