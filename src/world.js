import * as THREE from 'three';
import { clamp, lerp, smooth, hash2, vnoise, fbm } from './noise.js';

// ---------------------------------------------------------------- terrain field
export const OPP = { x: 3000, z: 2000, yaw: 0.6 };

export function heightAt(x, z) {
  let h = (fbm(x * 0.0035, z * 0.0035, 4) - 0.5) * 30;
  h += (fbm(x * 0.016 + 50, z * 0.016, 4) - 0.5) * 5.0;
  h += (fbm(x * 0.11, z * 0.11 + 30, 3) - 0.5) * 0.5;
  const r = 1 - Math.abs(vnoise(x * 0.028 + 7, z * 0.028 + 3) * 2 - 1);
  h += Math.pow(r, 5) * 1.8;
  const m = fbm(x * 0.0006 + 11, z * 0.0006, 3) - 0.52;
  if (m > 0) h += m * m * 2600;
  // impact craters
  const cs = 70, cx = Math.floor(x / cs), cz = Math.floor(z / cs);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const gx = cx + i, gz = cz + j;
    if (hash2(gx * 3 + 1, gz * 7 + 2) > 0.34) continue;
    const px = (gx + 0.2 + 0.6 * hash2(gx + 5, gz + 9)) * cs;
    const pz = (gz + 0.2 + 0.6 * hash2(gx + 11, gz + 3)) * cs;
    const rad = 7 + 18 * hash2(gx + 13, gz + 17);
    const d = Math.hypot(x - px, z - pz) / rad;
    if (d < 1.7) {
      const bowl = d < 1 ? -(1 - d * d) * rad * 0.16 : 0;
      const rim = Math.exp(-Math.pow((d - 1.05) / 0.22, 2)) * rad * 0.05;
      h += bowl + rim;
    }
  }
  // Opportunity's Meridiani-style plain: flat with wind ripples
  const dd = Math.hypot(x - OPP.x, z - OPP.z);
  const w = 1 - smooth(250, 800, dd);
  if (w > 0) {
    const rip = Math.sin(x * 0.9 + z * 0.35 + vnoise(x * 0.05, z * 0.05) * 6) * 0.1 +
                Math.sin(x * 0.25 - z * 0.6 + vnoise(x * 0.02, z * 0.02) * 5) * 0.25;
    h = lerp(h, h * 0.06 + rip, w);
  }
  return h;
}

const lin = (c) => Math.pow(c, 2.2);
const C_A = [lin(0.52), lin(0.28), lin(0.155)];
const C_B = [lin(0.80), lin(0.49), lin(0.29)];
const C_D = [lin(0.25), lin(0.155), lin(0.115)];
const C_OPP = [lin(0.36), lin(0.25), lin(0.19)];

export function terrainColor(x, z, slope, out, o) {
  const n = fbm(x * 0.05, z * 0.05, 3);
  const m = vnoise(x * 0.45, z * 0.45);
  let t = smooth(0.35, 0.7, n);
  let r = lerp(C_A[0], C_B[0], t), g = lerp(C_A[1], C_B[1], t), b = lerp(C_A[2], C_B[2], t);
  const dark = smooth(0.55, 0.72, fbm(x * 0.012 + 9, z * 0.012, 3));
  r = lerp(r, C_D[0], dark * 0.8); g = lerp(g, C_D[1], dark * 0.8); b = lerp(b, C_D[2], dark * 0.8);
  const sl = smooth(0.12, 0.5, slope);
  r *= 1 - sl * 0.45; g *= 1 - sl * 0.45; b *= 1 - sl * 0.45;
  const gr = 0.88 + m * 0.24;
  r *= gr; g *= gr; b *= gr;
  const dOpp = Math.hypot(x - OPP.x, z - OPP.z);
  const wo = 1 - smooth(250, 800, dOpp);
  if (wo > 0) { r = lerp(r, C_OPP[0] * gr, wo * 0.7); g = lerp(g, C_OPP[1] * gr, wo * 0.7); b = lerp(b, C_OPP[2] * gr, wo * 0.7); }
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
}

// ---------------------------------------------------------------- rover path (arc-length table)
const DS = 0.5, NP = 3000;
const PX = new Float32Array(NP), PZ = new Float32Array(NP), PY = new Float32Array(NP);
(() => {
  let x = 0, z = 0;
  for (let i = 0; i < NP; i++) {
    const u = i * DS;
    const th = 0.30 * Math.sin(u * 0.0072 + 0.4) + 0.22 * Math.sin(u * 0.019 + 1.3) + 0.12;
    PX[i] = x; PZ[i] = z; PY[i] = th;
    x += Math.cos(th) * DS; z += Math.sin(th) * DS;
  }
})();
export function pathAt(u) {
  const f = clamp(u, 0, (NP - 2) * DS) / DS;
  const i = Math.floor(f), k = f - i;
  return { x: lerp(PX[i], PX[i + 1], k), z: lerp(PZ[i], PZ[i + 1], k), yaw: lerp(PY[i], PY[i + 1], k) };
}

// ---------------------------------------------------------------- rover timeline
export const T_REC = 124;                    // moment the odometer passes Opportunity's 28.06 mi
export const U_HOOK = 900;
const sm = smooth;
function speed(t) {
  if (t < 102) return 0;
  let v = 2.1 * sm(101, 106, t);
  if (t >= 360 && t < 400) v *= 1 - sm(366, 374, t);
  else if (t >= 400) v *= sm(426, 434, t);
  if (t >= 456) v *= 1 - sm(458, 464, t);
  if (t >= 258 && t < 312) v = 1.5 * sm(258, 262, t);
  return v;
}
const UT = (() => {
  const dt = 0.05, N = Math.ceil((480 - 102) / dt) + 2;
  const a = new Float32Array(N); let u = 0;
  for (let i = 0; i < N; i++) { a[i] = u; u += speed(102 + i * dt) * dt; }
  return a;
})();
export function roverU(t) {
  if (t < 28) return U_HOOK + 1.7 * t;
  if (t < 102) return 0;
  const f = (t - 102) / 0.05, i = Math.min(Math.floor(f), UT.length - 2);
  return lerp(UT[i], UT[i + 1], f - i);
}
export function odometerMiles(t) {
  const m = 28.06 + (roverU(t) - roverU(T_REC)) * 0.000621371;
  return Math.min(28.10, m);
}

// ---------------------------------------------------------------- rover pose from terrain
export const WX = [1.35, -0.05, -1.45];
export const WZ = [-1.18, 1.18];
export const WHEEL_R = 0.26;

export function poseAt(u) {
  const c = pathAt(u);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const F = new THREE.Vector3(cy, 0, sy), S = new THREE.Vector3(-sy, 0, cy);
  const hubs = [];
  let sum = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const x = c.x + F.x * WX[i] + S.x * WZ[j], z = c.z + F.z * WX[i] + S.z * WZ[j];
    const h = heightAt(x, z);
    hubs.push(h); sum += h;
  }
  const hF = (hubs[0] + hubs[1]) / 2, hR = (hubs[4] + hubs[5]) / 2;
  const hL = (hubs[0] + hubs[2] + hubs[4]) / 3, hRt = (hubs[1] + hubs[3] + hubs[5]) / 3;
  const pitch = Math.atan2(hF - hR, WX[0] - WX[2]);
  const roll = -Math.atan2(hRt - hL, 2.36);
  const y = sum / 6;
  return { u, p: new THREE.Vector3(c.x, y, c.z), F, S, yaw: c.yaw, pitch, roll, hubs };
}
export function standAt(pose, f, s, h) {
  const x = pose.p.x + pose.F.x * f + pose.S.x * s, z = pose.p.z + pose.F.z * f + pose.S.z * s;
  return new THREE.Vector3(x, Math.max(heightAt(x, z) + 0.35, pose.p.y + h), z);
}
export function groundAt(x, z, h = 0) { return new THREE.Vector3(x, heightAt(x, z) + h, z); }

// ---------------------------------------------------------------- sun / sky keyframes (deg elevation)
const SUN_KEYS = [[0, 9], [28, 10], [29, 38], [62, 22], [63, 55], [100, 52], [101, 46], [258, 36], [312, 14], [340, 7], [372, 8], [373, 45], [425, 40], [426, 16], [462, 6], [470, -7], [480, -9]];
export function sunElev(t) {
  for (let i = 0; i < SUN_KEYS.length - 1; i++) {
    const [a, ea] = SUN_KEYS[i], [b, eb] = SUN_KEYS[i + 1];
    if (t >= a && t <= b) return lerp(ea, eb, (t - a) / (b - a));
  }
  return SUN_KEYS[SUN_KEYS.length - 1][1];
}
export const SUN_AZ = 2.35;
