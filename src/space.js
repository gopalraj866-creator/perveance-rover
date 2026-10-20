import * as THREE from 'three';
import { clamp, lerp, smooth, fbm, fbm3, vnoise, hash2, rng } from './noise.js';

// ------------------------------------------------------------ Mars sky dome
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uStars: { value: 0 }
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun, uHor, uZen, uGlow; uniform float uStars;
      float h31(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float el = d.y;
        float h = pow(clamp(1.0 - max(el,0.0), 0.0, 1.0), 2.6);
        vec3 col = mix(uZen, uHor, h);
        float s = max(dot(d, uSun), 0.0);
        col += uGlow * (pow(s, 5.0) * 0.35 + pow(s, 40.0) * 0.9);
        col += vec3(1.0, 0.93, 0.82) * smoothstep(0.99955, 0.99985, s) * 14.0;
        if (el < 0.0) col = mix(uHor, uHor*0.7, clamp(-el*6.0,0.0,1.0));
        if (uStars > 0.01 && el > -0.02) {
          vec3 q = d * 330.0; vec3 g = floor(q); float r = h31(g);
          vec3 fc = fract(q) - 0.5;
          float st = step(0.985, r) * (0.35 + 0.65*h31(g+7.3)) * smoothstep(0.42, 0.05, length(fc));
          float band = pow(max(0.0, 1.0 - abs(dot(d, normalize(vec3(0.3,0.5,0.8))))*2.4), 2.0);
          col += (vec3(st) * vec3(0.9,0.95,1.0) * 1.6 + vec3(0.05,0.06,0.09)*band) * uStars * smoothstep(0.0, 0.08, el);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}

export function skyParams(elevDeg) {
  const k = smooth(-4, 24, elevDeg);                    // day factor
  const tw = smooth(-14, 6, elevDeg);                   // twilight factor
  const lin = (r, g, b) => new THREE.Color(Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2));
  const hor = lin(0.012, 0.014, 0.03).lerp(lin(0.45, 0.28, 0.22), tw).lerp(lin(0.82, 0.58, 0.40), k);
  const zen = lin(0.002, 0.003, 0.012).lerp(lin(0.16, 0.12, 0.13), tw).lerp(lin(0.52, 0.38, 0.30), k);
  const glow = lin(0.30, 0.52, 0.85).multiplyScalar(smooth(-8, 3, elevDeg) * (1 - smooth(10, 34, elevDeg) * 0.8) * 0.9);
  return { hor, zen, glow, stars: 1 - smooth(-10, 1, elevDeg), day: k, tw };
}

// ------------------------------------------------------------ stars (space scenes) + Mars globe
export function makeStarfield() {
  const r = rng(7), n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 1700;
    pos[i * 3] = R * s * Math.cos(a); pos[i * 3 + 1] = R * u; pos[i * 3 + 2] = R * s * Math.sin(a);
    const b = 0.35 + 0.65 * Math.pow(r(), 3);
    col[i * 3] = b; col[i * 3 + 1] = b * (0.9 + 0.1 * r()); col[i * 3 + 2] = b * (0.85 + 0.2 * r());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
  p.frustumCulled = false;
  return p;
}

export function marsLonLat(lonDeg, latDeg, R = 100) {
  const lon = lonDeg * Math.PI / 180, lat = latDeg * Math.PI / 180;
  return new THREE.Vector3(R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(lon));
}

export function makeGlobe() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), im = cx.createImageData(W, H);
  const lin = (c) => c;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2 - Math.PI;
      const px = cl * Math.sin(lon), py = sl, pz = cl * Math.cos(lon);
      const n1 = fbm3(px * 2.2 + 3, py * 2.2, pz * 2.2, 5);
      const n2 = fbm3(px * 9 + 1, py * 9 + 2, pz * 9, 3);
      let t = smooth(0.38, 0.66, n1);
      let r = lerp(0.36, 0.78, t), g = lerp(0.18, 0.46, t), b = lerp(0.12, 0.28, t);
      const dk = smooth(0.52, 0.66, fbm3(px * 3.6 + 9, py * 3.6, pz * 3.6, 4));        // dark basaltic terrain
      r = lerp(r, 0.20, dk * 0.7); g = lerp(g, 0.12, dk * 0.7); b = lerp(b, 0.10, dk * 0.7);
      // Valles Marineris-like scar
      const vlon = lon * 180 / Math.PI, vlat = lat * 180 / Math.PI;
      const sc = Math.exp(-Math.pow((vlat + 9 + 2.2 * Math.sin(vlon * 0.2)) / 2.2, 2)) * smooth(-95, -78, vlon) * (1 - smooth(-45, -32, vlon));
      r = lerp(r, 0.17, sc * 0.8); g = lerp(g, 0.09, sc * 0.8); b = lerp(b, 0.07, sc * 0.8);
      const gr = 0.9 + n2 * 0.2; r *= gr; g *= gr; b *= gr;
      const cap = smooth(74, 84, Math.abs(vlat) + 5 * (n2 - 0.5));                       // polar ice
      r = lerp(r, 0.95, cap); g = lerp(g, 0.94, cap); b = lerp(b, 0.92, cap);
      const i = (y * W + x) * 4;
      im.data[i] = clamp(r, 0, 1) * 255; im.data[i + 1] = clamp(g, 0, 1) * 255; im.data[i + 2] = clamp(b, 0, 1) * 255; im.data[i + 3] = 255;
    }
  }
  cx.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const group = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(100, 128, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
  group.add(globe);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(102.2, 96, 64), new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uSun: { value: new THREE.Vector3(-1, 0.3, 0.8).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.2);
        vec3 c = mix(vec3(0.85,0.48,0.25), vec3(0.45,0.60,0.85), f*f);
        gl_FragColor = vec4(c*f*0.9, f);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  group.add(atmo);
  return { group, globe, atmo };
}

// ------------------------------------------------------------ orbital "HiRISE-style" map of Jezero (illustrative)
export const MAP_SIZE = 700;
export function macroH(x, y) {
  const r = Math.hypot(x, y) / 225;
  let h = -0.22 + (fbm(x * 0.02, y * 0.02, 4) - 0.5) * 0.06;
  h += 0.52 * Math.exp(-Math.pow((r - 1) / 0.12, 2)) * (0.7 + 0.8 * fbm(x * 0.03 + 5, y * 0.03, 3));
  if (r > 1.05) h += 0.1 + 0.18 * (fbm(x * 0.012 + 3, y * 0.012, 4)) + (r - 1.05) * 0.05;
  const dd = Math.hypot(x + 110, y - 10) / 75;
  const rid = 1 - Math.abs(vnoise(x * 0.06, y * 0.06) * 2 - 1);
  h += 0.24 * Math.exp(-dd * dd) * (0.55 + 0.45 * Math.pow(rid, 3));
  // little craters
  const cs = 55, gx = Math.floor(x / cs), gz = Math.floor(y / cs);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const ax = gx + i, az = gz + j; if (hash2(ax * 3 + 1, az * 5 + 2) > 0.3) continue;
    const px = (ax + 0.2 + 0.6 * hash2(ax + 4, az + 8)) * cs, pz = (az + 0.2 + 0.6 * hash2(ax + 2, az + 6)) * cs;
    const rad = 4 + 9 * hash2(ax + 9, az + 1), d = Math.hypot(x - px, y - pz) / rad;
    if (d < 1.5) h += (d < 1 ? -(1 - d * d) * 0.05 : 0) + Math.exp(-Math.pow((d - 1.05) / 0.2, 2)) * 0.03;
  }
  return h;
}
export function makeMapTexture() {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d'), im = cx.createImageData(S, S);
  const W = S + 2, Hh = new Float32Array(W * W), step = MAP_SIZE / S;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) Hh[j * W + i] = macroH((i - 1) * step - MAP_SIZE / 2, (j - 1) * step - MAP_SIZE / 2);
  const L = new THREE.Vector3(-0.6, 0.65, -0.5).normalize();
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = (j + 1) * W + (i + 1), h = Hh[k];
    const dx = (Hh[k + 1] - Hh[k - 1]) / (2 * step), dz = (Hh[k + W] - Hh[k - W]) / (2 * step);
    const k0 = 9.0, n = new THREE.Vector3(-dx * k0, 1, -dz * k0).normalize();
    const sh = clamp(0.55 + 0.7 * (n.dot(L) - 0.7), 0.15, 1.35);
    const x = (i * step) - MAP_SIZE / 2, y = (j * step) - MAP_SIZE / 2;
    const rr = Math.hypot(x, y) / 225;
    const delta = Math.exp(-Math.pow(Math.hypot(x + 110, y - 10) / 75, 2));
    const gr = 0.9 + 0.2 * vnoise(i * 0.35, j * 0.35);
    let r = lerp(0.40, 0.62, smooth(-0.1, 0.4, h)), g = lerp(0.27, 0.43, smooth(-0.1, 0.4, h)), b = lerp(0.20, 0.31, smooth(-0.1, 0.4, h));
    if (rr < 1) { r = lerp(r, 0.30, 0.45); g = lerp(g, 0.23, 0.45); b = lerp(b, 0.19, 0.45); }
    r = lerp(r, 0.72, delta * 0.7); g = lerp(g, 0.54, delta * 0.7); b = lerp(b, 0.38, delta * 0.7);
    r *= sh * gr; g *= sh * gr; b *= sh * gr;
    const p = (j * S + i) * 4;
    im.data[p] = clamp(r, 0, 1) * 255; im.data[p + 1] = clamp(g, 0, 1) * 255; im.data[p + 2] = clamp(b, 0, 1) * 255; im.data[p + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
// illustrative route across the crater to the western rim, in map units (1 unit ~ 100 m)
export const ROUTE_PTS = [[-30, 70], [-70, 60], [-100, 38], [-125, 12], [-118, -22], [-98, -48], [-118, -86], [-150, -104], [-176, -128], [-204, -150], [-232, -128], [-252, -96], [-266, -62]];
