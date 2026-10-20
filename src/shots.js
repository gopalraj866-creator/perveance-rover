import * as THREE from 'three';
import { clamp, lerp, ease, easeOut, smooth } from './noise.js';
import { poseAt, roverU, standAt, groundAt, heightAt, OPP, T_REC } from './world.js';
import { marsLonLat, MAP_SIZE } from './space.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mix = (a, b, k) => a.clone().lerp(b, k);
const up = (p, y) => V(p.x, p.y + y, p.z);
const aboveGround = (p, m = 0.4) => { p.y = Math.max(p.y, heightAt(p.x, p.z) + m); return p; };

export const JEZERO = marsLonLat(77.5, 18.4, 100);
export const OUTCROP_OFFSET = { f: 3.7, s: -1.5 };
export function outcropPos(R) {
  const x = R.p.x + R.F.x * OUTCROP_OFFSET.f + R.S.x * OUTCROP_OFFSET.s, z = R.p.z + R.F.z * OUTCROP_OFFSET.f + R.S.z * OUTCROP_OFFSET.s;
  return V(x, heightAt(x, z), z);
}
export function landingAlt(t) {
  if (t < 78) return 60;
  if (t < 92) return 60 * Math.pow(1 - (t - 78) / 14, 1.7);
  return 0;
}
export function craneUp(t) { const d = Math.max(0, t - 93); return 7.7 + 0.4 * d * d; }

export function oppPose() {
  const p = groundAt(OPP.x, OPP.z, 0);
  return p;
}

// ------------------------------------------------------------ map route (scene 7)
export const ROUTE = null;

export function cameraFor(t, ctx) {
  const R = () => poseAt(roverU(t));
  const shake = (p, a, f = 1) => { p.x += Math.sin(t * 7.3 * f) * a; p.y += Math.sin(t * 9.1 * f + 1.3) * a * 0.7; p.z += Math.sin(t * 6.1 * f + 2.1) * a; return p; };
  const RS = (ts) => poseAt(roverU(ts));
  let pos, look, fov = 40;

  // ---------------------------------------------------------------- scene 1 : hook
  if (t < 28) {
    const r = R();
    if (t < 5.2) {                              // low head-on fixed camera, rover rolls toward it
      const rs = RS(0); pos = standAt(rs, 14.5, -3.2, 0.75); look = up(r.p, 1.25); fov = 34;
      return { pos, look, fov, scene: 'surface' };
    }
    if (t < 10) {
      const lt = t - 5.2;
      pos = standAt(r, 4.6 - 0.15 * lt, 3.0, 0.55); look = r.p.clone().addScaledVector(r.F, 0.6).addScaledVector(r.S, 0.5); look.y += 0.55; fov = 36;
      return { pos: shake(pos, 0.012), look, fov, scene: 'surface' };
    }
    if (t < 16) { pos = standAt(r, 0.8 + (t - 10) * 0.1, 7.5, 1.15); look = up(r.p, 1.1); fov = 30; return { pos: shake(pos, 0.01), look, fov, scene: 'surface' }; }
    if (t < 22) {
      const a = 0.6 + (t - 16) * 0.2; pos = V(r.p.x + Math.cos(a) * 19, r.p.y + 11, r.p.z + Math.sin(a) * 19); look = up(r.p, 0.8); fov = 38;
      return { pos: aboveGround(pos), look, fov, scene: 'surface' };
    }
    const lt = t - 22; pos = standAt(r, -7 - lt * 0.7, 0.8, 1.8 + lt * 0.6); look = r.p.clone().addScaledVector(r.F, 4); look.y += 1; fov = 40;
    return { pos: shake(pos, 0.01), look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 2 : Opportunity
  if (t < 62) {
    const o = oppPose(), c = up(o, 0.75), yaw = OPP.yaw;
    const place = (ang, rad, h) => aboveGround(V(o.x + Math.cos(ang + yaw) * rad, o.y + h, o.z + Math.sin(ang + yaw) * rad), 0.5);
    if (t < 40) { const k = (t - 28) / 12; pos = place(0.5 + k * 1.0, lerp(14, 10, k), 3.2); look = c; fov = 38; }
    else if (t < 52) { const k = (t - 40) / 12; pos = place(-0.7 + k * 0.5, lerp(6.5, 3.6, ease(k)), lerp(0.8, 1.0, k)); look = up(o, lerp(0.7, 0.9, k)); fov = 36; }
    else { const k = (t - 52) / 10; pos = place(2.2, lerp(8, 30, ease(k)), lerp(2, 20, ease(k))); look = mix(c, up(o, 6), ease(k)); fov = 38; }
    return { pos, look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 3 : landing
  if (t < 100) {
    if (t < 78) {                                // orbital approach to Jezero
      const k = (t - 62) / 16, e = easeOut(k);
      const jn = JEZERO.clone().normalize();
      const away = jn.clone().applyAxisAngle(V(0, 1, 0), 1.25 * (1 - e)).applyAxisAngle(V(1, 0, 0), 0.35 * (1 - e));
      pos = away.multiplyScalar(lerp(420, 172, e));
      look = JEZERO.clone().multiplyScalar(smooth(0.1, 1, k) * 0.98);
      return { pos, look, fov: lerp(34, 30, k), scene: 'globe' };
    }
    const R0 = RS(100), alt = landingAlt(t), tx = R0.p.clone();
    const rov = up(tx, 1.4 + alt);
    if (t < 86) { pos = standAt(R0, 34, 16, 1.7); look = mix(rov, up(tx, alt + 8), 0.4); fov = 36; }
    else if (t < 93) { pos = standAt(R0, 17, -10, 1.5); look = up(tx, 3 + alt * 0.8); fov = 40; }
    else { const k = (t - 93) / 7; pos = standAt(R0, 20, -12, 1.4); look = mix(up(tx, 1.6), up(tx, craneUp(t)), clamp(k * 0.3, 0, 1)); fov = 40; }
    return { pos, look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 4 : record day
  if (t < 155) {
    const r = R();
    if (t < 108) { const k = ease((t - 100) / 8); pos = mix(standAt(r, -5, 1.0, 2.0), standAt(r, -16, 6, 4.5), k); look = r.p.clone().addScaledVector(r.F, 2); look.y += 1.2; fov = 40; }
    else if (t < 118) { pos = standAt(r, 1.0 + (t - 108) * 0.12, 6.6, 1.0); look = up(r.p, 1.0); fov = 32; }
    else if (t < 130) {
      const k = (t - 118) / 12; pos = standAt(r, -13 + 3.0 * k, 2.8, 2.9); look = r.p.clone().addScaledVector(r.F, 1.5); look.y += 1.1; fov = 38;
      const burst = smooth(T_REC - 0.8, T_REC, t) * (1 - smooth(T_REC + 0.3, T_REC + 2.2, t));
      pos = shake(pos, 0.01 + 0.07 * burst, 2);
      return { pos, look, fov: fov - 5 * smooth(T_REC - 1, T_REC + 1, t), scene: 'surface' };
    }
    else if (t < 138) { const lt = t - 130; pos = standAt(r, 4.4 - 0.12 * lt, -3.0, 0.55); look = r.p.clone().addScaledVector(r.F, 0.6).addScaledVector(r.S, -0.5); look.y += 0.55; fov = 36; }
    else if (t < 147) { const a = 3.8 + (t - 138) * 0.16; pos = aboveGround(V(r.p.x + Math.cos(a) * 17, r.p.y + 9, r.p.z + Math.sin(a) * 17)); look = up(r.p, 0.8); fov = 38; }
    else { const rs = RS(147); pos = standAt(rs, 16, 2.4, 0.9); look = up(r.p, 1.2); fov = 34; }
    return { pos: shake(pos, 0.01), look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 5 : AutoNav
  if (t < 215) {
    const r = R();
    if (t < 165) { pos = standAt(r, -9, 0.0, 4.4); look = r.p.clone().addScaledVector(r.F, 12); look.y += 0.4; fov = 46; }
    else if (t < 180) { pos = standAt(r, -5.2, 0.0, 3.0); look = r.p.clone().addScaledVector(r.F, 18); look.y += 0.4; fov = 50; }
    else if (t < 195) { const rs = RS(180); pos = standAt(rs, 20, -9, 3.0); look = r.p.clone().addScaledVector(r.F, 5); look.y += 0.8; fov = 40; }
    else if (t < 205) { pos = standAt(r, 3, 0.5, 40); look = r.p.clone().addScaledVector(r.F, 11); fov = 44; }
    else { pos = standAt(r, -5.5, 0.9, 1.4); look = r.p.clone().addScaledVector(r.F, 3); look.y += 0.9; fov = 40; }
    return { pos: shake(pos, 0.008), look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 6 : beyond the plan
  if (t < 258) {
    const r = R();
    if (t < 228) { const rs = RS(215); pos = standAt(rs, 38, 14, 1.8); look = up(r.p, 1.0); fov = 26; }
    else if (t < 243) { pos = standAt(r, 0.5 + (t - 228) * 0.05, 8.4, 1.4); look = up(r.p, 1.1); fov = 34; }
    else {
      const k = ease((t - 243) / 15);
      pos = mix(standAt(r, -6, 0, 2.0), standAt(r, -70, 25, 70), k);
      look = mix(up(r.p, 1.0), r.p.clone().addScaledVector(r.F, -55), k); fov = 40;
    }
    return { pos, look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 7 : orbital route map
  if (t < 312) {
    const p = ease(clamp((t - 262) / 44, 0, 1));
    const target = ctx.routePoint(p);
    const a = 0.7 + (t - 258) * 0.013, d = 58 + 14 * Math.sin((t - 258) * 0.1), h = 46 - 6 * p;
    const near = V(target.x + Math.sin(a) * d, h, target.z + Math.cos(a) * d);
    const wide = V(0, 340, 300);
    const k = smooth(258 + 1, 258 + 14, t);
    pos = mix(wide, near, k); look = mix(V(0, 0, 0), target, k);
    return { pos, look, fov: lerp(42, 40, k), scene: 'map' };
  }

  // ---------------------------------------------------------------- scene 8 : leaderboard / sunset drive
  if (t < 372) {
    const r = R();
    if (t < 322) { pos = standAt(r, -6, 1.2, 0.9); look = r.p.clone().addScaledVector(r.F, 3); look.y += 1.0; fov = 38; }
    else if (t < 336) { const rs = RS(322); pos = standAt(rs, 20, -6, 1.2); look = up(r.p, 1.1); fov = 32; }
    else if (t < 350) { const lt = t - 336; pos = standAt(r, 4.4 - 0.1 * lt, 3.0, 0.55); look = r.p.clone().addScaledVector(r.F, 0.6).addScaledVector(r.S, 0.5); look.y += 0.55; fov = 36; }
    else if (t < 362) { const a = (t - 350) * 0.2; pos = aboveGround(V(r.p.x + Math.cos(a) * 9, r.p.y + 2.4, r.p.z + Math.sin(a) * 9)); look = up(r.p, 1.1); fov = 36; }
    else { pos = standAt(r, 0.5, -8, 1.0); look = up(r.p, 1.1); fov = 32; }
    return { pos: shake(pos, 0.008), look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 9 : science stop
  if (t < 425) {
    const r = R(), oc = outcropPos(r), head = standAt(r, 1.1, -0.55, 2.55);
    if (t < 384) { const lt = t - 372, a = 0.3 + lt * 0.1; pos = aboveGround(V(r.p.x + Math.cos(a) * (8 - 0.2 * lt), r.p.y + 1.8, r.p.z + Math.sin(a) * (8 - 0.2 * lt))); look = up(r.p, 1.2); fov = 36; }
    else if (t < 396) { pos = standAt(r, 2.3, 1.5, 1.7); look = up(oc, 0.6).lerp(standAt(r, 1.1, -0.55, 2.4), 0.45); fov = 34; }
    else if (t < 408) {
      const k = (t - 396) / 12; pos = aboveGround(V(oc.x + 2.2 - 0.6 * k, oc.y + 0.55, oc.z - 2.4 + 0.5 * k), 0.3); look = up(oc, 0.5); fov = 40;
    }
    else { const k = (t - 408) / 17, a = 2.0 + k * 1.5; pos = aboveGround(V(r.p.x + Math.cos(a) * 5.2, r.p.y + lerp(1.6, 3.6, k), r.p.z + Math.sin(a) * 5.2)); look = up(r.p, 1.6); fov = 36; }
    return { pos: shake(pos, t >= 384 && t < 396 ? 0.0 : 0.006), look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 10 : far from done
  if (t < 462) {
    const r = R();
    if (t < 437) { pos = standAt(r, -14, 3, 12); look = up(r.p, 0.8); fov = 38; }
    else if (t < 449) { const rs = RS(437); pos = standAt(rs, 26, 12, 1.6); look = up(r.p, 1.1); fov = 30; }
    else { const k = ease((t - 449) / 13); pos = mix(standAt(r, -8, 0, 3), standAt(r, -80, 10, 60), k); look = mix(up(r.p, 1.2), r.p.clone().addScaledVector(r.F, 35), k); fov = 40; }
    return { pos, look, fov, scene: 'surface' };
  }

  // ---------------------------------------------------------------- scene 11 : night outro
  const r = R(), k = (t - 462) / 18;
  pos = standAt(r, 8.5 - 2.6 * k, 1.5, 0.7); look = up(r.p, 1.2 + 3.2 * ease(k)).addScaledVector(r.F, 1.5);
  return { pos, look, fov: 36, scene: 'surface' };
}
