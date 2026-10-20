import * as THREE from 'three';
import { heightAt, terrainColor, pathAt } from './world.js';
import { hash2, vnoise, rng, smooth } from './noise.js';

// ------------------------------------------------------------ tileable detail textures
function periodicNoise(x, y, N, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2((((a % N) + N) % N) + seed * 131, (((b % N) + N) % N) + seed * 71);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function makeDetailTextures(size = 512) {
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 0.5, n = 0;
    for (let o = 0; o < 6; o++) {
      const N = 4 << o; v += a * periodicNoise(x / size * N, y / size * N, N, o); n += a; a *= 0.55;
    }
    hgt[y * size + x] = v / n;
  }
  const alb = document.createElement('canvas'); alb.width = alb.height = size;
  const nrm = document.createElement('canvas'); nrm.width = nrm.height = size;
  const ca = alb.getContext('2d'), cn = nrm.getContext('2d');
  const ia = ca.createImageData(size, size), inn = cn.createImageData(size, size);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, h = at(x, y);
    const g = Math.max(0, Math.min(255, 150 + (h - 0.5) * 230));
    ia.data[i] = g; ia.data[i + 1] = g; ia.data[i + 2] = g; ia.data[i + 3] = 255;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 9, dy = (at(x, y + 1) - at(x, y - 1)) * 9;
    const l = Math.hypot(dx, dy, 1);
    inn.data[i] = (-dx / l * 0.5 + 0.5) * 255; inn.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; inn.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; inn.data[i + 3] = 255;
  }
  ca.putImageData(ia, 0, 0); cn.putImageData(inn, 0, 0);
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nrm, false) };
}

// ------------------------------------------------------------ terrain: moving window of analytic height field
function buildGrid(N, size) {
  const V = (N + 1) * (N + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(V * 2), 2));
  return g;
}

export class Terrain {
  constructor(material) {
    this.near = { N: 224, size: 190 }; this.far = { N: 150, size: 3600 };
    this.near.cell = this.near.size / this.near.N; this.far.cell = this.far.size / this.far.N;
    this.group = new THREE.Group();
    this.nearGeo = buildGrid(this.near.N, this.near.size);
    const idx = [];
    const N = this.near.N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.nearGeo.setIndex(idx);
    this.nearMesh = new THREE.Mesh(this.nearGeo, material);
    this.nearMesh.receiveShadow = true; this.nearMesh.frustumCulled = false;
    this.farGeo = buildGrid(this.far.N, this.far.size);
    this.farMesh = new THREE.Mesh(this.farGeo, material);
    this.farMesh.frustumCulled = false;
    this.group.add(this.nearMesh, this.farMesh);
    this.key = ''; this.farKey = '';
    this.buildFarIndex();
    this.initRocks();
  }
  buildFarIndex() {
    const N = this.far.N, idx = [], half = N / 2, hole = Math.floor(88 / this.far.cell);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ci = i - half + 0.5, cj = j - half + 0.5;
      if (Math.abs(ci) < hole && Math.abs(cj) < hole) continue;
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.farGeo.setIndex(idx);
  }
  fill(geo, cfg, cx, cz, withUV) {
    const { N, size, cell } = cfg;
    const W = N + 3, H = new Float32Array(W * W);
    const x0 = cx - size / 2 - cell, z0 = cz - size / 2 - cell;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) H[j * W + i] = heightAt(x0 + i * cell, z0 + j * cell);
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, col = geo.attributes.color.array, uv = geo.attributes.uv.array;
    let v = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++, v++) {
      const hi = (j + 1) * W + (i + 1);
      const h = H[hi];
      const dx = (H[hi + 1] - H[hi - 1]) / (2 * cell), dz = (H[hi + W] - H[hi - W]) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      const lx = -size / 2 + i * cell, lz = -size / 2 + j * cell;
      pos[v * 3] = lx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = lz;
      nor[v * 3] = -dx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -dz / l;
      terrainColor(cx + lx, cz + lz, Math.hypot(dx, dz), col, v * 3);
      uv[v * 2] = (cx + lx) * 0.17; uv[v * 2 + 1] = (cz + lz) * 0.17;
    }
    geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.uv.needsUpdate = true;
  }
  initRocks() {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.78 + 0.45 * vnoise(x * 1.7 + 4, y * 1.7 + z * 1.3);
      p.setXYZ(i, x * n, y * n * 0.7, z * n);
    }
    g.computeVertexNormals();
    this.MAXR = 1100;
    this.rocks = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }), this.MAXR);
    this.rocks.castShadow = true; this.rocks.receiveShadow = true; this.rocks.frustumCulled = false;
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAXR * 3), 3);
    this.group.add(this.rocks);
    this.rockKey = '';
  }
  updateRocks(cx, cz, uFocus) {
    const cs = 4.5, R = 78;
    const gx0 = Math.floor((cx - R) / cs), gx1 = Math.floor((cx + R) / cs), gz0 = Math.floor((cz - R) / cs), gz1 = Math.floor((cz + R) / cs);
    // sampled path window so rocks never sit in the rover's lane
    const pts = [];
    if (uFocus != null) for (let k = -120; k <= 140; k += 2) pts.push(pathAt(uFocus + k));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pp = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    for (let gz = gz0; gz <= gz1 && n < this.MAXR; gz++) for (let gx = gx0; gx <= gx1 && n < this.MAXR; gx++) {
      const a = hash2(gx * 5 + 3, gz * 11 + 7);
      if (a > 0.62) continue;
      const x = (gx + hash2(gx + 1, gz + 2)) * cs, z = (gz + hash2(gx + 8, gz + 5)) * cs;
      let blocked = false;
      for (const q0 of pts) if ((q0.x - x) * (q0.x - x) + (q0.z - z) * (q0.z - z) < 7.5) { blocked = true; break; }
      if (blocked) continue;
      const b = hash2(gx + 21, gz + 33);
      let sc = 0.12 + 0.5 * Math.pow(b, 3);
      if (hash2(gx + 41, gz + 9) > 0.965) sc = 0.9 + 1.6 * hash2(gx + 7, gz + 77);
      const y = heightAt(x, z);
      e.set(hash2(gx, gz + 4) * 0.5, hash2(gx + 9, gz) * 6.28, hash2(gx + 3, gz + 3) * 0.5);
      q.setFromEuler(e);
      s.set(sc * (0.9 + 0.5 * hash2(gx + 2, gz + 6)), sc * 0.8, sc * (0.9 + 0.5 * hash2(gx + 6, gz + 2)));
      pp.set(x, y + sc * 0.18, z);
      m.compose(pp, q, s);
      this.rocks.setMatrixAt(n, m);
      const tone = 0.05 + 0.13 * hash2(gx + 55, gz + 13);
      c.setRGB(tone * 1.0, tone * 0.66, tone * 0.48);
      this.rocks.setColorAt(n, c);
      n++;
    }
    this.rocks.count = n;
    this.rocks.instanceMatrix.needsUpdate = true; this.rocks.instanceColor.needsUpdate = true;
  }
  update(fx, fz, uFocus) {
    const cn = this.near.cell, cf = this.far.cell;
    const nx = Math.round(fx / cn) * cn, nz = Math.round(fz / cn) * cn;
    const k = nx.toFixed(2) + ',' + nz.toFixed(2);
    if (k !== this.key) {
      this.key = k;
      this.fill(this.nearGeo, this.near, nx, nz, true);
      this.nearMesh.position.set(nx, 0, nz);
      this.updateRocks(nx, nz, uFocus);
    }
    const fxs = Math.round(fx / cf) * cf, fzs = Math.round(fz / cf) * cf;
    const fk = fxs + ',' + fzs;
    if (fk !== this.farKey) {
      this.farKey = fk;
      this.fill(this.farGeo, this.far, fxs, fzs, true);
      this.farMesh.position.set(fxs, -1.6, fzs);
    }
  }
}

// ------------------------------------------------------------ wheel tracks laid down behind the rover
export class Tracks {
  constructor() {
    const geo = new THREE.PlaneGeometry(0.42, 0.62); geo.rotateX(-Math.PI / 2);
    this.MAX = 700;
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a170f, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.MAX * 2);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
  }
  update(uNow, uMin) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let n = 0;
    const u0 = Math.max(uMin, uNow - 190);
    for (let u = u0; u < uNow - 1.2 && n < this.MAX * 2 - 1; u += 0.55) {
      const c = pathAt(u), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -c.yaw);
      for (const side of [-1.18, 1.18]) {
        const x = c.x - sy * side, z = c.z + cy * side;
        p.set(x, heightAt(x, z) + 0.035, z);
        m.compose(p, q, s); this.mesh.setMatrixAt(n++, m);
      }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
