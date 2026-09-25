import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads the A350 exported from blender-wow (tools/export_a350.py) and
 * re-implements the Blender drivers on its hinge empties so control
 * surfaces, flaps/slats, gear and fans animate from game state.
 *
 * Blender → glTF axis mapping for a node's local frame: X→X, Y→−Z, Z→Y.
 * Nodes were exported at their rest driver values (all controls 0, gear 1),
 * so every channel applies `f(state) − f(rest)` on top of the exported pose.
 */

export interface ControlState {
  aileron: number; // −1..1, + = roll right
  elevator: number; // −1..1, + = nose up
  rudder: number; // −1..1, + = yaw right
  flaps: number; // 0..1
  spoilers: number; // 0..1
  gear: number; // 0 = up, 1 = down
  steering: number; // −1..1
  throttle: number; // 0..1
}

const REST: ControlState = {
  aileron: 0, elevator: 0, rudder: 0, flaps: 0, spoilers: 0, gear: 1, steering: 0, throttle: 0,
};

type Axis = 'x' | 'y' | 'z';
interface Channel {
  node: string; // Blender object name
  kind: 'rot' | 'loc';
  axis: Axis; // Blender local axis
  f: (s: ControlState) => number;
}

const AXIS3: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 0, -1),
  z: new THREE.Vector3(0, 1, 0),
};

const K = 1.4311699866353502; // main gear swing angle

function channels(): Channel[] {
  const ch: Channel[] = [];
  const add = (node: string, kind: Channel['kind'], axis: Axis, f: Channel['f']) => ch.push({ node, kind, axis, f });

  for (const side of ['L', 'R'] as const) {
    const m = side === 'L' ? 1 : -1; // mirrored sign where the Blender drivers differ per side
    add(`${side} aileron hinge`, 'rot', 'y', (s) => -m * 0.34 * s.aileron);
    add(`${side} elevator hinge`, 'rot', 'y', (s) => 0.4 * s.elevator);
    for (const f of ['inboard', 'outboard']) {
      add(`${side} ${f} flap hinge`, 'rot', 'y', (s) => 0.56 * s.flaps);
      add(`${side} ${f} flap hinge`, 'loc', 'x', (s) => 0.65 * s.flaps);
    }
    for (let i = 0; i < 6; i++) add(`${side} spoiler hinge ${i}`, 'rot', 'y', (s) => -0.9 * s.spoilers);
    add(`${side} droop nose actuator`, 'rot', 'y', (s) => -0.29 * s.flaps);
    for (let i = 1; i <= 6; i++) {
      add(`${side} slat ${i} actuator`, 'rot', 'y', (s) => -0.22 * s.flaps);
      add(`${side} slat ${i} actuator`, 'loc', 'x', (s) => -0.35 * s.flaps);
      add(`${side} slat ${i} actuator`, 'loc', 'z', (s) => -0.08 * s.flaps);
    }

    // undercarriage
    add(`${side} main gear trunnion`, 'rot', 'x', (s) => m * K * (1 - s.gear));
    add(`${side} articulated bogie`, 'rot', 'x', (s) => -m * K * (1 - s.gear));
    add(`${side} articulated bogie`, 'loc', 'y', (s) => {
      const a = m * K * (1 - s.gear);
      return Math.cos(a) * (m * 4.365 * (1 - s.gear)) + Math.sin(a) * (-0.22 - 3.4 * s.gear);
    });
    add(`${side} articulated bogie`, 'loc', 'z', (s) => {
      const a = m * K * (1 - s.gear);
      return -Math.sin(a) * (m * 4.365 * (1 - s.gear)) + Math.cos(a) * (-0.22 - 3.4 * s.gear);
    });
    add(`${side} bogie stay joint`, 'loc', 'z', (s) => 0.15 + 0.57 * s.gear);
    add(`${side} main bay door hinge`, 'rot', 'x', (s) => -m * 1.1 * Math.sin(Math.PI * s.gear));
    add(`${side} nose bay door hinge`, 'rot', 'x', (s) => -m * 1.35 * s.gear);
  }
  add('Rudder hinge', 'rot', 'z', (s) => 0.48 * s.rudder);
  add('Nose gear retract', 'rot', 'y', (s) => -Math.PI / 2 * (1 - s.gear));
  add('Nose gear retract', 'rot', 'z', (s) => 0.55 * s.steering);
  return ch;
}

/** Blender DAMPED_TRACK constraints on the main gear struts (track axis +Y). */
const TRACKS: [string, string][] = [
  ['Drag brace', 'L bogie stay joint'],
  ['Drag brace.001', 'R bogie stay joint'],
  ['Side stay', 'L bogie stay joint'],
  ['Side stay.001', 'R bogie stay joint'],
  ['Main chrome piston', 'L articulated bogie'],
  ['Main chrome piston.001', 'R articulated bogie'],
  ['Main oleo housing', 'L articulated bogie'],
  ['Main oleo housing.001', 'R articulated bogie'],
];

interface RigNode {
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  rot: Partial<Record<Axis, Channel[]>>;
  loc: Partial<Record<Axis, Channel[]>>;
}

export class Aircraft {
  readonly object = new THREE.Group(); // physics transform, nose along −Z
  /** Distance from the aircraft origin down to the tyres (gear down) / lowest airframe point (gear up). */
  gearHeight = 6;
  bellyHeight = 3;
  length = 74;

  private root?: THREE.Object3D;
  private rig: RigNode[] = [];
  private tracks: { obj: THREE.Object3D; target: THREE.Object3D; baseQuat: THREE.Quaternion }[] = [];
  private fans: THREE.Object3D[] = [];
  private fanBase: THREE.Quaternion[] = [];
  private fanAngle = 0;

  async load(url: string, onProgress?: (p: number) => void): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    const model = gltf.scene;
    model.rotation.y = -Math.PI / 2; // Blender nose −X → three −Z
    this.object.add(model);

    const byName = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      byName.set(o.name, o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.name?.includes('glazing')) {
          mat.transparent = true;
          mat.opacity = 0.55;
          mat.roughness = 0.05;
        }
      }
    });
    const find = (blenderName: string) => byName.get(THREE.PropertyBinding.sanitizeNodeName(blenderName));

    this.root = find('A350 FLIGHT CONTROLS') ?? model;

    // group channels per node
    const nodes = new Map<string, RigNode>();
    for (const c of channels()) {
      const obj = find(c.node);
      if (!obj) {
        console.warn('rig: missing node', c.node);
        continue;
      }
      let n = nodes.get(c.node);
      if (!n) {
        n = { obj, basePos: obj.position.clone(), baseQuat: obj.quaternion.clone(), rot: {}, loc: {} };
        nodes.set(c.node, n);
      }
      (n[c.kind][c.axis] ??= []).push(c);
    }
    this.rig = [...nodes.values()];

    for (const [objName, targetName] of TRACKS) {
      const obj = find(objName), target = find(targetName);
      if (obj && target) this.tracks.push({ obj, target, baseQuat: obj.quaternion.clone() });
      else console.warn('rig: missing track', objName, targetName);
    }

    for (const side of ['L', 'R']) {
      const fan = find(`${side} fan rotor`);
      if (fan) {
        this.fans.push(fan);
        this.fanBase.push(fan.quaternion.clone());
      }
    }

    this.pose(REST, 0);
    this.measure(model);
  }

  private measure(model: THREE.Object3D) {
    // measured relative to the aircraft origin, whatever its current transform
    this.object.position.set(0, 0, 0);
    this.object.quaternion.identity();
    this.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    this.gearHeight = -box.min.y;
    this.length = box.max.z - box.min.z;

    // lowest point of everything that isn't landing gear
    const gearRoots = new Set(
      ['L main gear trunnion', 'R main gear trunnion', 'Nose gear retract', ...TRACKS.map((t) => t[0])].map((n) =>
        THREE.PropertyBinding.sanitizeNodeName(n),
      ),
    );
    const belly = new THREE.Box3();
    const tmp = new THREE.Box3();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (gearRoots.has(p.name)) return;
      belly.union(tmp.setFromObject(mesh));
    });
    this.bellyHeight = -belly.min.y;
  }

  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  /** Apply control/gear state to the rig. */
  pose(s: ControlState, dt: number) {
    if (!this.root) return;
    for (const n of this.rig) {
      n.obj.position.copy(n.basePos);
      for (const axis of ['x', 'y', 'z'] as Axis[]) {
        for (const c of n.loc[axis] ?? []) {
          n.obj.position.addScaledVector(AXIS3[axis], c.f(s) - c.f(REST));
        }
      }
      // Blender XYZ euler = Rz·Ry·Rx, applied on top of the rest pose
      n.obj.quaternion.copy(n.baseQuat);
      for (const axis of ['z', 'y', 'x'] as Axis[]) {
        const list = n.rot[axis];
        if (!list) continue;
        let a = 0;
        for (const c of list) a += c.f(s) - c.f(REST);
        n.obj.quaternion.multiply(this.tmpQ.setFromAxisAngle(AXIS3[axis], a));
      }
    }

    this.fanAngle += (2 + 16 * s.throttle) * dt;
    this.fans.forEach((fan, i) => {
      fan.quaternion.copy(this.fanBase[i]).multiply(this.tmpQ.setFromAxisAngle(AXIS3.x, this.fanAngle));
    });

    // damped-track struts: rotate the strut's +Y (Blender) toward its target,
    // everything in the root's frame (struts are direct children of the root)
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const targetPos = new THREE.Vector3();
    for (const t of this.tracks) {
      targetPos.setFromMatrixPosition(t.target.matrixWorld).applyMatrix4(rootInv);
      const dir = targetPos.sub(t.obj.position).normalize();
      const axis = this.tmpV.copy(AXIS3.y).applyQuaternion(t.baseQuat);
      t.obj.quaternion.setFromUnitVectors(axis, dir).multiply(t.baseQuat);
    }
  }
}
