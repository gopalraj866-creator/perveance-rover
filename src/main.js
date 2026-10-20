import * as THREE from 'three';
import { clamp, lerp, smooth, ease, easeOut, fbm, hash2, vnoise } from './noise.js';
import { heightAt, poseAt, roverU, odometerMiles, sunElev, SUN_AZ, OPP, T_REC, pathAt } from './world.js';
import { Terrain, Tracks, makeDetailTextures } from './terrain.js';
import { Perseverance, Opportunity, SkyCrane } from './rover.js';
import { makeSky, skyParams, makeStarfield, makeGlobe, makeMapTexture, marsLonLat, MAP_SIZE, ROUTE_PTS } from './space.js';
import { cameraFor, JEZERO, landingAlt, craneUp, outcropPos, oppPose } from './shots.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1920, H = +q.get('h') || 1080;
const MODE = q.get('mode') || 'main';
const THUMB = q.has('thumb');
const SHADOW = +q.get('shadow') || (Math.max(W, H) > 2500 ? 4096 : 2048);
const U = (W > H ? H : W) / 1080;
document.documentElement.style.setProperty('--u', U + 'px');
if (W < H) document.documentElement.classList.add('port');
const stage = document.getElementById('stage'); stage.style.width = W + 'px'; stage.style.height = H + 'px';
if (W < H) document.body.classList.add('port');
if (W < H) stage.classList.add('port');

const TL = await (await fetch('./data/timeline.json')).json();
const CAPS = TL[MODE].captions;
const DUR = TL[MODE].duration;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.get('aa') !== '0', preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.12, 4000);

const hemi = new THREE.HemisphereLight(0xe8b890, 0x6a3a20, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c8, 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(SHADOW, SHADOW);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 320 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

// ------------------------------------------------------------------ surface world
const det = makeDetailTextures(512);
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: det.albedo, normalMap: det.normal, normalScale: new THREE.Vector2(0.85, 0.85), roughness: 0.97, metalness: 0 });
const terrain = new Terrain(terrainMat);
if (q.get('rocks') === '0') terrain.rocks.visible = false;
const tracks = new Tracks();
const sky = makeSky();
const surface = new THREE.Group(); surface.add(terrain.group, tracks.mesh);
scene.add(sky, surface);

const rover = new Perseverance(); surface.add(rover.group);
const opp = new Opportunity(); surface.add(opp.group);
const crane = new SkyCrane(); surface.add(crane.group);
const roverLight = new THREE.PointLight(0x66e6ff, 0, 14, 2); surface.add(roverLight);

// outcrop for the science scene
const outcrop = (() => {
  const g = new THREE.IcosahedronGeometry(1, 5), p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.75 + 0.35 * vnoise(x * 2.2 + 3, y * 1.4 + z * 2.2) + 0.16 * vnoise(x * 7 + 1, y * 6 + z * 7);
    p.setXYZ(i, x * n * 1.5, Math.max(y, -0.2) * n * 0.9, z * n * 1.1);
    const band = 0.5 + 0.5 * Math.sin(y * 9 + vnoise(x * 3, z * 3) * 3);
    col[i * 3] = lerp(0.45, 0.72, band); col[i * 3 + 1] = lerp(0.27, 0.5, band); col[i * 3 + 2] = lerp(0.17, 0.36, band);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: det.albedo, normalMap: det.normal }));
  m.castShadow = m.receiveShadow = true;
  const grp = new THREE.Group(); grp.add(m);
  for (let i = 0; i < 4; i++) { const s = m.clone(); s.scale.setScalar(0.25 + 0.15 * i); s.position.set(1.6 + i * 0.5, 0, -0.9 + (i % 2) * 1.5); grp.add(s); }
  surface.add(grp); return grp;
})();
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), new THREE.MeshBasicMaterial({ color: 0xff3a1a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false }));
const spark = new THREE.PointLight(0xff7a3a, 0, 6, 2);
surface.add(laser, spark);

// soft round sprite
const sprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();

// ambient dust motes
const NDUST = 1800, dustBase = new Float32Array(NDUST * 3);
for (let i = 0; i < NDUST; i++) { dustBase[i * 3] = hash2(i, 1); dustBase[i * 3 + 1] = hash2(i, 2); dustBase[i * 3 + 2] = hash2(i, 3); }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NDUST * 3), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: sprite, color: 0xd9a77a, size: 0.14, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true }));
dust.frustumCulled = false; surface.add(dust);

// landing plume
const NPL = 700, plumeGeo = new THREE.BufferGeometry(); plumeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NPL * 3), 3));
const plume = new THREE.Points(plumeGeo, new THREE.PointsMaterial({ map: sprite, color: 0xc99870, size: 2.2, transparent: true, opacity: 0.5, depthWrite: false }));
plume.frustumCulled = false; surface.add(plume);

// AutoNav hazard scan + planned path
const COLS = 61, ROWS = 44, NSC = COLS * ROWS;
const scanGeo = new THREE.BufferGeometry();
scanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NSC * 3), 3));
scanGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NSC * 3), 3));
const scan = new THREE.Points(scanGeo, new THREE.PointsMaterial({ map: sprite, size: 0.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
scan.frustumCulled = false; surface.add(scan);
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x7af0ff, toneMapped: false }), 40);
dots.frustumCulled = false; surface.add(dots);

// ------------------------------------------------------------------ space scenes: globe + stars, orbital map
const globeObj = makeGlobe();
const stars = makeStarfield();
const space = new THREE.Group(); space.add(globeObj.group, stars); scene.add(space);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 48), new THREE.MeshBasicMaterial({ color: 0x5ee6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, toneMapped: false, depthTest: false }));
marker.position.copy(JEZERO).multiplyScalar(1.004); marker.lookAt(JEZERO.clone().multiplyScalar(2)); marker.renderOrder = 5; space.add(marker);

const mapGroup = new THREE.Group(); scene.add(mapGroup);
const mapTex = makeMapTexture();
const mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), new THREE.MeshBasicMaterial({ map: mapTex, toneMapped: false }));
mapPlane.rotation.x = -Math.PI / 2; mapGroup.add(mapPlane);
const routeCurve = new THREE.CatmullRomCurve3(ROUTE_PTS.map(([x, z]) => V3(x, 0.7, z)), false, 'catmullrom', 0.5);
const SEG = 600, RAD = 6;
const tube = new THREE.Mesh(new THREE.TubeGeometry(routeCurve, SEG, 0.9, RAD, false), new THREE.MeshBasicMaterial({ color: 0x5ee6ff, toneMapped: false }));
tube.frustumCulled = false; mapGroup.add(tube);
const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff7a2b, toneMapped: false })); mapGroup.add(head);
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: 0xff7a2b, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })); halo.scale.setScalar(16); mapGroup.add(halo);
const crater = (() => {
  const g = new THREE.RingGeometry(224, 226, 128); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, toneMapped: false })); m.position.y = 0.5; mapGroup.add(m); return m;
})();
function routePoint(p) { return routeCurve.getPoint(clamp(p, 0, 1)); }

// ------------------------------------------------------------------ DOM / HUD
const $ = (id) => document.getElementById(id);
if (q.get('nograin') === '1') document.getElementById('grain').style.display = 'none';
if (q.get('novig') === '1') document.getElementById('vig').style.display = 'none';
const el = { fade: $('fade'), flash: $('flash'), cap: $('cap'), capMain: document.querySelector('#cap .main'), capSub: document.querySelector('#cap .sub'), capbg: $('capbg'),
  odo: $('odo'), odoMi: $('odoMi'), odoKm: $('odoKm'), chapter: $('chapter'), banner: $('banner'), bars: $('bars'), barRows: $('barRows'), nav: $('nav'), plan: $('plan'),
  labels: $('labels'), brand: $('brand'), endcards: $('endcards'), thumb: $('thumb'), grain: $('grain') };
const LB = [['PERSEVERANCE', 45.22, 'hi'], ['OPPORTUNITY', 45.16, ''], ['LUNOKHOD 2', 39.0, ''], ['CURIOSITY', 38.15, ''], ['APOLLO 17 LRV', 35.74, '']];
const barEls = LB.map(([name, km, hi]) => {
  const r = document.createElement('div'); r.className = 'row ' + hi;
  r.innerHTML = `<div class="nm">${name}</div><div class="tr"><div class="fl"></div></div><div class="vl"></div>`;
  el.barRows.appendChild(r); return { fl: r.querySelector('.fl'), vl: r.querySelector('.vl'), km };
});
const lbl = [['LANDING SITE', 0, 0.0], ['JEZERO DELTA', -1, 0.12], ['IDUBI', 1, 0.9]].map(([name, which, at]) => {
  const d = document.createElement('div'); d.className = 'lb'; d.textContent = name; el.labels.appendChild(d); return { d, which, at, name };
});
const lblPos = { 0: V3(ROUTE_PTS[0][0], 1, ROUTE_PTS[0][1]), '-1': V3(-110, 1, 10), 1: V3(ROUTE_PTS[ROUTE_PTS.length - 1][0], 1, ROUTE_PTS[ROUTE_PTS.length - 1][1]) };
(() => { // film grain tile
  const c = el.grain.getContext('2d'), im = c.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = Math.random() * 255; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  c.putImageData(im, 0, 0);
})();
if (MODE === 'main') {
  const mk = (l, t, w, h, txt) => { const b = document.createElement('div'); b.className = 'box'; Object.assign(b.style, { left: `calc(var(--u)*${l})`, top: `calc(var(--u)*${t})`, width: `calc(var(--u)*${w})`, height: `calc(var(--u)*${h})` }); b.textContent = txt; el.endcards.appendChild(b); };
  mk(120, 210, 640, 360, 'WATCH NEXT'); mk(1160, 210, 640, 360, 'SUBSCRIBE');
}

const segs = TL.shorts.segments;
function mainT(ts) {
  if (MODE !== 'shorts') return ts;
  for (const s of segs) if (ts >= s.s0 && ts < s.s1 + 1e-6) return s.m0 + (ts - s.s0);
  const l = segs[segs.length - 1]; return l.m0 + (ts - l.s0);
}
const boundaries = MODE === 'shorts' ? segs.slice(1).map((s) => s.s0) : TL.main.scenes.slice(1).map((s) => s.start);
const win = (t, a, b, f = 0.5) => smooth(a, a + f, t) * (1 - smooth(b - f, b, t));
const fmt = (n) => n.toLocaleString('en-US');

function hudUpdate(tt, mt) {
  if (THUMB) return;
  // fade to black (start / end / cuts)
  let fade = 1 - smooth(0, MODE === 'shorts' ? 0.2 : 0.7, tt);
  fade = Math.max(fade, smooth(DUR - 1.3, DUR - 0.1, tt));
  const dip = MODE === 'shorts' ? 0.28 : 0.5;
  for (const b of boundaries) fade = Math.max(fade, 1 - smooth(0, dip, Math.abs(tt - b)));
  el.fade.style.opacity = fade.toFixed(3);

  // captions
  let cap = null;
  for (const c of CAPS) if (tt >= c.t0 && tt <= c.t1) { cap = c; break; }
  if (cap) {
    const a = win(tt, cap.t0, cap.t1, 0.45);
    if (el.capMain.textContent !== cap.text) { el.capMain.textContent = cap.text; el.capSub.textContent = cap.sub || ''; }
    el.capSub.style.display = cap.sub ? 'block' : 'none';
    el.cap.style.opacity = a.toFixed(3); el.cap.style.transform = `translateY(${((1 - a) * 22 * U).toFixed(1)}px)`;
    el.capbg.style.opacity = a.toFixed(3);
  } else { el.cap.style.opacity = 0; el.capbg.style.opacity = 0; }

  // odometer
  const odoOn = (mt >= 102 && mt < 258) || (mt >= 425 && mt < 462);
  el.odo.style.opacity = (odoOn ? win(mt, mt < 300 ? 102 : 425, mt < 300 ? 258 : 462, 1) : 0).toFixed(3);
  if (odoOn) {
    const mi = odometerMiles(mt);
    el.odoMi.textContent = mi.toFixed(2); el.odoKm.textContent = (mi * 1.609344).toFixed(2);
    el.odoMi.style.color = (mt >= T_REC && mt < T_REC + 4) ? '#ff9a5a' : '#fff';
  }

  // chapter card (main only)
  let ch = 0;
  if (MODE === 'main') for (const s of TL.main.scenes) if (s.id >= 2 && s.id <= 10 && mt >= s.start + 0.4 && mt < s.start + 4.6) {
    const a = win(mt, s.start + 0.4, s.start + 4.6, 0.6);
    ch = a; el.chapter.querySelector('.n').textContent = 'CHAPTER ' + String(s.id - 1).padStart(2, '0');
    el.chapter.querySelector('.t').textContent = s.title; el.chapter.querySelector('.bar').style.width = (ease((mt - s.start - 0.4) / 1.2) * 420 * U) + 'px';
  }
  el.chapter.style.opacity = ch.toFixed(3);

  // record banner + flash
  const ba = smooth(T_REC, T_REC + 0.3, mt) * (1 - smooth(T_REC + 5.6, T_REC + 6.8, mt));
  el.banner.style.opacity = ba.toFixed(3); el.banner.style.transform = `scale(${(1 + 0.18 * (1 - easeOut((mt - T_REC) / 0.8))).toFixed(3)})`;
  el.flash.style.opacity = (mt >= T_REC && mt < T_REC + 1.5 ? 0.75 * Math.exp(-(mt - T_REC) * 7) : 0).toFixed(3);

  // AutoNav panel
  const na = (mt >= 158 && mt < 213) ? win(mt, 158, 213, 0.8) : 0;
  el.nav.style.opacity = na.toFixed(3);
  if (na > 0) {
    $('navPts').textContent = fmt(Math.round(600000 * ease((mt - 160) / 8) * 0.999 + (mt > 168 ? Math.round((Math.sin(mt * 3) * 0.5 + 0.5) * 900) : 0)));
    const pP = ease((mt - 194) / 4) * 0.9, pO = ease((mt - 195) / 4) * 0.05;
    $('navP').style.width = (pP * 100) + '%'; $('navO').style.width = (pO * 100) + '%';
    $('navPv').textContent = mt > 194 ? '90%+' : '0%'; $('navOv').textContent = mt > 195 ? '~5%' : '0%';
    if (mt < 194) { $('navP').style.width = '0%'; }
  }
  // plan vs actual
  const pa = (mt >= 217 && mt < 257) ? win(mt, 217, 257, 0.8) : 0;
  el.plan.style.opacity = pa.toFixed(3);
  if (pa > 0) {
    const a = ease((mt - 219) / 4) * 12.4, b = ease((mt - 228) / 8) * 28.1;
    $('planP').style.width = (a / 30 * 100) + '%'; $('planA').style.width = (b / 30 * 100) + '%';
    $('planPv').textContent = a.toFixed(1) + ' mi'; $('planAv').textContent = b.toFixed(1) + ' mi';
  }
  // leaderboard
  const la = (mt >= 314 && mt < 371) ? win(mt, 314, 371, 0.8) : 0;
  el.bars.style.opacity = la.toFixed(3);
  if (la > 0) barEls.forEach((b, i) => {
    const pr = ease((mt - (316 + i * 1.1)) / 9);
    b.fl.style.width = (b.km / 50 * 100 * pr) + '%'; b.vl.textContent = (b.km * pr).toFixed(2) + ' km';
  });
  // map labels
  const mapOn = mt >= 258 && mt < 312;
  const rp = ease(clamp((mt - 262) / 44, 0, 1));
  for (const L of lbl) {
    const a = mapOn ? win(mt, 262, 311, 1.2) * smooth(L.at, L.at + 0.05, rp + (L.which === -1 ? 0.25 : 0.03)) : 0;
    L.d.style.opacity = a.toFixed(3);
    if (a > 0) {
      const v = lblPos[L.which].clone().project(camera);
      L.d.style.left = ((v.x * 0.5 + 0.5) * W) + 'px'; L.d.style.top = ((-v.y * 0.5 + 0.5) * H - 18 * U) + 'px';
      if (v.z > 1) L.d.style.opacity = 0;
    }
  }
  // end cards
  if (MODE === 'main') el.endcards.style.opacity = smooth(463, 465, tt).toFixed(3);
  // film grain jitter
  const f = Math.floor(tt * 30);
  el.grain.style.transform = `translate(${(hash2(f, 1) * 60 - 30) * U}px,${(hash2(f, 2) * 60 - 30) * U}px)`;
}

// ------------------------------------------------------------------ frame
const tmpC = new THREE.Color();
function applySurfaceLighting(mt, focus) {
  const e = sunElev(mt), er = e * Math.PI / 180;
  const sd = V3(Math.cos(er) * Math.cos(SUN_AZ), Math.sin(er), Math.cos(er) * Math.sin(SUN_AZ));
  const sp = skyParams(e);
  sky.material.uniforms.uSun.value.copy(sd); sky.material.uniforms.uHor.value.copy(sp.hor);
  sky.material.uniforms.uZen.value.copy(sp.zen); sky.material.uniforms.uGlow.value.copy(sp.glow); sky.material.uniforms.uStars.value = sp.stars;
  const day = smooth(-1, 9, e);
  sun.intensity = 3.6 * day; sun.visible = day > 0.01;
  sun.color.setRGB(1, lerp(0.58, 0.92, smooth(2, 30, e)), lerp(0.36, 0.82, smooth(2, 30, e)));
  sun.position.copy(focus).addScaledVector(sd, 120); sun.target.position.copy(focus); sun.target.updateMatrixWorld();
  hemi.color.copy(sp.hor).lerp(new THREE.Color(0.9, 0.7, 0.55), 0.3); hemi.groundColor.set(0x5a3320);
  hemi.intensity = lerp(0.07, 0.95, smooth(-8, 20, e));
  scene.fog = new THREE.FogExp2(sp.hor.clone(), lerp(0.0052, 0.0034, smooth(0, 30, e)));
  renderer.toneMappingExposure = lerp(1.9, 0.95, smooth(-6, 14, e));
  return { e, sp };
}

function renderAt(tt) {
  const mt = MODE === 'shorts' ? mainT(tt) : tt;
  const cam = cameraFor(mt, { routePoint });
  const isSurf = cam.scene === 'surface', isGlobe = cam.scene === 'globe', isMap = cam.scene === 'map';
  surface.visible = isSurf; sky.visible = isSurf; space.visible = isGlobe; mapGroup.visible = isMap;
  const u = roverU(mt);
  const R = poseAt(u);

  if (isSurf) {
    // terrain follows whichever subject is on screen
    const onOpp = mt >= 28 && mt < 62;
    const o = oppPose();
    const focus = onOpp ? V3(o.x, o.y, o.z) : R.p.clone();
    terrain.update(focus.x, focus.z, onOpp ? null : u);
    tracks.mesh.visible = !onOpp && u > 20; if (tracks.mesh.visible) tracks.update(u, 0);
    const { e, sp } = applySurfaceLighting(mt, focus);
    sky.position.copy(cam.pos);

    // rover
    const landing = mt >= 78 && mt < 100;
    const roverOn = mt < 28 || (mt >= 78 && mt < 258) || mt >= 312;
    rover.group.visible = roverOn;
    const alt = landing ? landingAlt(mt) : 0;
    if (roverOn) rover.update(R, alt);
    rover.lamp.material.color.setRGB(0.4, 0.9, 1).multiplyScalar(1 + 3 * (1 - smooth(-4, 8, e)));
    roverLight.intensity = (1 - smooth(-6, 4, e)) * 3.5; roverLight.position.set(R.p.x, R.p.y + 2.8, R.p.z);
    // Opportunity
    opp.group.visible = onOpp;
    if (onOpp) { opp.group.position.set(o.x, o.y + 0.0, o.z); opp.group.rotation.set(0, -OPP.yaw, 0); }
    // sky crane
    crane.group.visible = landing;
    if (landing) {
      const hang = mt < 93;
      const cy = hang ? R.p.y + alt + 7.7 : R.p.y + craneUp(mt);
      const dx = hang ? 0 : Math.pow(mt - 93, 1.5) * 0.9;
      crane.group.position.set(R.p.x + dx, cy, R.p.z);
      crane.group.rotation.set(0, -R.yaw, 0);
      const pts = [];
      if (hang) for (const [x, z] of [[0.9, 0.6], [0.9, -0.6], [-0.8, 0]]) { pts.push(0, -0.3, 0, x, -7.7 + 1.55, z); }
      crane.cables.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      crane.cables.visible = hang;
    }
    // landing plume
    const pAge = mt - 84;
    plume.visible = mt >= 84 && mt < 100;
    if (plume.visible) {
      const pa = plume.geometry.attributes.position.array;
      for (let i = 0; i < NPL; i++) {
        const ang = hash2(i, 5) * Math.PI * 2, sp0 = 1.5 + hash2(i, 6) * 7, rise = hash2(i, 7);
        const age = Math.min(pAge, 9) * (0.6 + 0.4 * hash2(i, 9));
        const r = sp0 * Math.pow(age, 0.85) * 0.9 + 0.5 * rise;
        pa[i * 3] = R.p.x + Math.cos(ang) * r; pa[i * 3 + 2] = R.p.z + Math.sin(ang) * r;
        pa[i * 3 + 1] = heightAt(pa[i * 3], pa[i * 3 + 2]) + 0.3 + rise * 2.8 * (1 - Math.exp(-age * 0.5));
      }
      plume.geometry.attributes.position.needsUpdate = true;
      plume.material.opacity = 0.55 * smooth(84, 88, mt) * (1 - smooth(95, 100, mt));
    }
    // ambient dust
    const BOX = 60, dp = dust.geometry.attributes.position.array, wind = [0.9, 0.12, 0.35];
    for (let i = 0; i < NDUST; i++) for (let k = 0; k < 3; k++) {
      const b = dustBase[i * 3 + k] * BOX + wind[k] * mt * (1 + hash2(i, 11) * 0.5);
      const c = k === 0 ? cam.pos.x : k === 1 ? cam.pos.y : cam.pos.z;
      let d = ((b - c) % BOX + BOX) % BOX; dp[i * 3 + k] = c + d - BOX / 2;
      if (k === 1) dp[i * 3 + k] = Math.max(heightAt(dp[i * 3], dp[i * 3 + 2]) + 0.1, c + (d - BOX / 2) * 0.35);
    }
    dust.geometry.attributes.position.needsUpdate = true; dust.material.opacity = 0.34 * smooth(-2, 12, e) + 0.05;
    // science scene: outcrop + laser
    const sci = mt >= 372 && mt < 425;
    outcrop.visible = sci;
    if (sci) {
      const oc = outcropPos(R); outcrop.position.copy(oc); outcrop.rotation.y = -R.yaw + 0.4;
      rover.group.updateMatrixWorld(true);
      const lz = mt >= 388 && mt < 395 && ((mt * 2.2) % 1) < 0.6;
      laser.visible = lz; spark.intensity = lz ? 6 : 0;
      if (lz) {
        const a = new THREE.Vector3(); rover.mastHead.getWorldPosition(a);
        const b = oc.clone(); b.y += 0.75; const dirv = b.clone().sub(a), len = dirv.length();
        laser.position.copy(a).addScaledVector(dirv, 0.5); laser.scale.set(1, len, 1);
        laser.quaternion.setFromUnitVectors(V3(0, 1, 0), dirv.normalize()); spark.position.copy(b);
      }
    } else { laser.visible = false; spark.intensity = 0; }
    // AutoNav scan
    const scOn = mt >= 156 && mt < 214;
    scan.visible = scOn; dots.visible = scOn;
    if (scOn) {
      const pa = scan.geometry.attributes.position.array, ca = scan.geometry.attributes.color.array;
      const rad = (((mt * 0.34) % 1) * 30), fade = win(mt, 156, 214, 2.5);
      let n = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++, n++) {
        const d = 2.2 + r * 0.6, s = (c - (COLS - 1) / 2) * 0.32;
        const x = R.p.x + R.F.x * d + R.S.x * s, z = R.p.z + R.F.z * d + R.S.z * s;
        const h = heightAt(x, z);
        const sl = Math.hypot(heightAt(x + 0.35, z) - h, heightAt(x, z + 0.35) - h) / 0.35;
        const hz = clamp(smooth(0.1, 0.38, sl) + smooth(0.68, 0.82, fbm(x * 0.4, z * 0.4, 2)) * 0.8, 0, 1);
        const lit = d < rad ? (0.3 + 0.7 * Math.exp(-(rad - d) * 0.3)) : 0;
        const k = lit * fade * (d < rad && rad - d < 1.2 ? 1.8 : 1) * (1 - smooth(18, 30, d) * 0.6);
        pa[n * 3] = x; pa[n * 3 + 1] = h + 0.06; pa[n * 3 + 2] = z;
        const safe = [0.08, 0.85, 0.72], warn = [1, 0.68, 0.1], bad = [1, 0.18, 0.14];
        const m = hz < 0.5 ? hz * 2 : (hz - 0.5) * 2, A = hz < 0.5 ? safe : warn, B = hz < 0.5 ? warn : bad;
        ca[n * 3] = lerp(A[0], B[0], m) * k; ca[n * 3 + 1] = lerp(A[1], B[1], m) * k; ca[n * 3 + 2] = lerp(A[2], B[2], m) * k;
      }
      scan.geometry.attributes.position.needsUpdate = scan.geometry.attributes.color.needsUpdate = true;
      const mm = new THREE.Matrix4(), sc = new THREE.Vector3();
      for (let i = 0; i < 40; i++) {
        const c = pathAt(u + 3.5 + i * 0.85); const p = V3(c.x, heightAt(c.x, c.z) + 0.16, c.z);
        const s = fade * (0.6 + 0.4 * Math.sin(mt * 6 - i * 0.5)) * (1 - i / 48);
        sc.setScalar(Math.max(0.001, s)); mm.compose(p, new THREE.Quaternion(), sc); dots.setMatrixAt(i, mm);
      }
      dots.instanceMatrix.needsUpdate = true;
    }
  } else if (isGlobe) {
    scene.fog = null; renderer.toneMappingExposure = 1.05;
    const sd = JEZERO.clone().normalize().applyAxisAngle(V3(0, 1, 0), 0.85).add(V3(0, 0.28, 0)).normalize();
    sun.visible = true;
    sun.position.copy(sd.clone().multiplyScalar(500)); sun.target.position.set(0, 0, 0); sun.intensity = 3.4; sun.color.set(0xfff0e0); sun.castShadow = false;
    hemi.intensity = 0.05; globeObj.atmo.material.uniforms.uSun.value.copy(sd);
    const k = (mt - 62) / 16; marker.scale.setScalar(lerp(5, 1, easeOut(k)) * (1 + 0.15 * Math.sin(mt * 5)));
    marker.material.opacity = smooth(0.2, 0.5, k);
    stars.position.copy(cam.pos);
  } else if (isMap) {
    scene.fog = null; renderer.toneMappingExposure = 1;
    sun.intensity = 0; hemi.intensity = 0.2;
    const p = ease(clamp((mt - 262) / 44, 0, 1));
    const n = Math.max(2, Math.floor(p * SEG)) * RAD * 6;
    tube.geometry.setDrawRange(0, n);
    const hp = routePoint(p); head.position.copy(hp).setY(1.6); halo.position.copy(hp).setY(3);
    halo.material.opacity = 0.55 + 0.25 * Math.sin(mt * 6);
  }
  if (!isGlobe) sun.castShadow = true;

  const aspect = W / H;
  camera.aspect = aspect; camera.fov = clamp(cam.fov * (aspect < 1 ? 1.6 : 1), 10, 88); camera.updateProjectionMatrix();
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  hudUpdate(tt, mt);
  return true;
}

if (THUMB) {
  el.thumb.style.display = 'block';
  for (const k of ['fade', 'cap', 'capbg', 'odo', 'chapter', 'banner', 'bars', 'nav', 'plan', 'labels', 'endcards', 'brand']) el[k].style.display = 'none';
  el.fade.style.display = 'none';
}
window.__render = renderAt;
window.__ready = true;
if (q.has('t')) renderAt(+q.get('t'));
