import * as THREE from 'three';
import { WX, WZ, WHEEL_R } from './world.js';

const mat = (c, r = 0.6, m = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
const box = (w, h, d, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = o.receiveShadow = true; return o; };
const cyl = (r1, r2, h, seg, m) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); o.castShadow = o.receiveShadow = true; return o; };

function link(m, a, b, thick) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
  m.scale.set(len, thick, thick);
  m.rotation.set(0, 0, Math.atan2(dy, dx));
}

export class Perseverance {
  constructor() {
    this.group = new THREE.Group();
    const dust = (c) => new THREE.Color(c).lerp(new THREE.Color(0xb07a52), 0.14);
    const white = mat(dust(0xe9e5dc), 0.55, 0.15), grey = mat(dust(0x9a9a9c), 0.5, 0.5), dark = mat(0x1b1b1e, 0.7, 0.3),
      gold = mat(0xc89a3a, 0.35, 0.9), alu = mat(dust(0xb8b8bb), 0.42, 0.85), black = mat(0x0c0c0e, 0.8, 0.1);
    const body = new THREE.Group(); this.body = body; this.group.add(body);

    const chassis = box(2.3, 0.62, 1.55, white); chassis.position.set(0, 1.0, 0); body.add(chassis);
    const deck = box(2.45, 0.07, 1.75, white); deck.position.set(0, 1.35, 0); body.add(deck);
    for (const s of [-1, 1]) { const b = box(2.0, 0.46, 0.05, gold); b.position.set(0.05, 1.0, s * 0.8); body.add(b); }
    const web = box(1.5, 0.3, 1.2, grey); web.position.set(-0.1, 1.55, 0); body.add(web);
    const pan = box(0.6, 0.05, 0.5, dark); pan.position.set(0.5, 1.72, 0.2); body.add(pan);

    // RTG tail with fins
    const rtg = new THREE.Group(); rtg.position.set(-1.35, 1.15, 0); rtg.rotation.z = 0.28; body.add(rtg);
    const core = cyl(0.19, 0.19, 0.95, 18, black); core.rotation.z = Math.PI / 2; core.position.x = -0.45; rtg.add(core);
    for (let i = 0; i < 8; i++) {
      const f = box(0.8, 0.03, 0.22, dark); const a = i * Math.PI / 4;
      f.position.set(-0.5, Math.sin(a) * 0.22, Math.cos(a) * 0.22); f.rotation.x = -a + Math.PI / 2; rtg.add(f);
    }
    // mast with camera head
    const mast = cyl(0.045, 0.055, 1.05, 12, alu); mast.position.set(0.85, 1.9, -0.55); body.add(mast);
    const head = box(0.5, 0.26, 0.34, white); head.position.set(0.88, 2.5, -0.55); body.add(head);
    for (const z of [-0.09, 0.09]) { const e = cyl(0.065, 0.065, 0.1, 16, black); e.rotation.z = Math.PI / 2; e.position.set(1.16, 2.5, -0.55 + z); body.add(e); }
    const sc = cyl(0.085, 0.085, 0.22, 16, dark); sc.rotation.z = Math.PI / 2; sc.position.set(1.03, 2.63, -0.55); body.add(sc);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), new THREE.MeshBasicMaterial({ color: 0x66e6ff }));
    this.lamp.position.set(1.08, 2.45, -0.4); body.add(this.lamp);
    this.mastHead = new THREE.Object3D(); this.mastHead.position.set(1.1, 2.55, -0.55); body.add(this.mastHead);
    // antennas
    const hga = cyl(0.3, 0.3, 0.03, 6, grey); hga.position.set(-0.35, 1.9, 0.62); hga.rotation.z = 0.45; body.add(hga);
    const hgaPole = cyl(0.03, 0.03, 0.5, 8, alu); hgaPole.position.set(-0.4, 1.62, 0.62); body.add(hgaPole);
    const lga = cyl(0.035, 0.035, 0.7, 8, alu); lga.position.set(-0.95, 1.7, -0.5); body.add(lga);
    // robotic arm folded at the front
    const turret = cyl(0.26, 0.26, 0.4, 20, dark); turret.rotation.z = Math.PI / 2; turret.position.set(1.28, 0.78, 0); body.add(turret);
    const a1 = box(0.7, 0.1, 0.1, alu); a1.position.set(1.55, 0.94, 0.15); body.add(a1);
    const a2 = box(0.5, 0.1, 0.1, alu); a2.position.set(1.5, 0.62, -0.15); body.add(a2);

    // rocker-bogie + wheels
    this.wheels = []; this.links = [];
    const tire = alu;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const w = new THREE.Group();
      const drum = cyl(WHEEL_R, WHEEL_R, 0.4, 28, tire); drum.rotation.x = Math.PI / 2; w.add(drum);
      const hub = cyl(0.12, 0.12, 0.44, 14, dark); hub.rotation.x = Math.PI / 2; w.add(hub);
      for (let k = 0; k < 20; k++) {
        const a = k / 20 * Math.PI * 2, g = box(0.05, 0.045, 0.4, alu);
        g.position.set(Math.cos(a) * (WHEEL_R + 0.012), Math.sin(a) * (WHEEL_R + 0.012), 0); g.rotation.z = a; w.add(g);
      }
      for (let k = 0; k < 5; k++) { const sp = box(0.5, 0.025, 0.02, dark); sp.rotation.z = k * Math.PI / 5; sp.position.z = (j ? 0.21 : -0.21); w.add(sp); }
      body.add(w); this.wheels.push(w);
    }
    for (let s = 0; s < 2; s++) for (let k = 0; k < 4; k++) { const l = box(1, 1, 1, dark); body.add(l); this.links.push(l); }
  }
  update(pose, alt = 0) {
    const g = this.group;
    g.position.set(pose.p.x, pose.p.y + alt, pose.p.z);
    g.quaternion.setFromEuler(new THREE.Euler(pose.roll, -pose.yaw, pose.pitch, 'YZX'));
    const spin = -pose.u / WHEEL_R;
    const hubs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const n = i * 2 + j;
      const y = alt > 0.01 ? WHEEL_R + 0.05 : Math.max(-0.25, Math.min(0.35, pose.hubs[n] - pose.p.y)) + WHEEL_R;
      this.wheels[n].position.set(WX[i], y, WZ[j]);
      this.wheels[n].rotation.z = spin;
      hubs.push(new THREE.Vector3(WX[i], y, WZ[j]));
    }
    for (let s = 0; s < 2; s++) {
      const z = WZ[s], front = hubs[s], mid = hubs[2 + s], rear = hubs[4 + s];
      const piv = new THREE.Vector3(0.15, 1.0, z * 0.7), bog = new THREE.Vector3(0.75, (front.y + mid.y) / 2 + 0.5, z);
      const L = this.links.slice(s * 4, s * 4 + 4);
      const P = (v) => ({ x: v.x, y: v.y, z: z });
      link(L[0], P(piv), P(rear), 0.07);
      link(L[1], P(piv), P(bog), 0.08);
      link(L[2], P(bog), P(mid), 0.06);
      link(L[3], P(bog), P(front), 0.06);
      L.forEach((l) => { l.position.z = z; });
    }
  }
}

export class Opportunity {
  constructor() {
    this.group = new THREE.Group();
    const d = (c) => new THREE.Color(c).lerp(new THREE.Color(0xa86b44), 0.45);
    const gold = new THREE.MeshStandardMaterial({ color: d(0xd7b25a), roughness: 0.5, metalness: 0.6 });
    const alu = new THREE.MeshStandardMaterial({ color: d(0xbdbdc0), roughness: 0.5, metalness: 0.7 });
    const panel = new THREE.MeshStandardMaterial({ color: d(0x23304f), roughness: 0.35, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1613, roughness: 0.8 });
    const b = (w, h, dd, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.castShadow = o.receiveShadow = true; return o; };
    const deck = b(1.5, 0.12, 1.0, panel); deck.position.y = 0.72; this.group.add(deck);
    const warm = b(1.1, 0.34, 0.8, gold); warm.position.y = 0.52; this.group.add(warm);
    for (const s of [-1, 1]) { const wing = b(1.4, 0.04, 0.5, panel); wing.position.set(0, 0.76, s * 0.75); wing.rotation.x = s * 0.05; this.group.add(wing); }
    const mast = b(0.05, 0.9, 0.05, alu); mast.position.set(0.55, 1.2, 0.1); this.group.add(mast);
    const cam = b(0.3, 0.12, 0.2, alu); cam.position.set(0.58, 1.68, 0.1); this.group.add(cam);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 20), alu); w.rotation.x = Math.PI / 2;
      w.position.set([0.55, 0, -0.55][i], 0.13, s * 0.58); w.castShadow = true; this.group.add(w);
    }
    const arm = b(0.5, 0.06, 0.06, dark); arm.position.set(0.9, 0.42, 0); this.group.add(arm);
  }
}

// Sky crane descent stage
export class SkyCrane {
  constructor() {
    this.group = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.5, metalness: 0.5 });
    const dk = new THREE.MeshStandardMaterial({ color: 0x2a2a2d, roughness: 0.6, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.4), m); body.castShadow = true; this.group.add(body);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), dk); arm.position.set(sx * 1.2, -0.05, sz * 0.9); this.group.add(arm);
      const th = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 14), dk); th.position.set(sx * 1.2, -0.35, sz * 1.5); th.castShadow = true; this.group.add(th);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.6, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fl.position.set(sx * 1.2, -1.3, sz * 1.5); fl.rotation.x = Math.PI; this.group.add(fl);
    }
    this.cables = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8e8e8 }));
    this.cables.frustumCulled = false; this.group.add(this.cables);
    this.cableLen = 7.4;
  }
}
