import * as THREE from 'three';
import type { ControlState } from './aircraft';

/**
 * Arcade flight model tuned loosely to an A350-sized airliner.
 *
 * Speed is a scalar along the nose. Lift is reduced to a "lift ratio"
 * (airspeed vs. stall speed, times cos(bank)); below 1 the aircraft
 * accumulates sink and the nose drops. Banking produces a coordinated turn.
 */

const G = 9.81;
const MAX_THRUST = 4.2; // m/s² at full throttle
const DRAG = 7.0e-5; // → ~245 m/s top speed clean
const STALL_CLEAN = 72; // m/s (~140 kt)
const STALL_FULL_FLAP = 52; // m/s (~100 kt)
const PITCH_RATE = 0.32; // rad/s at full deflection
const ROLL_RATE = 0.85;
const YAW_RATE = 0.12;
const MAX_BANK = THREE.MathUtils.degToRad(70);

export interface PilotInput {
  pitch: number; // + nose up
  roll: number; // + right
  yaw: number; // + right
  throttleDelta: number; // per second
  brake: boolean;
}

export class FlightModel {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  speed = 0;
  sink = 0; // m/s downward, from missing lift
  onGround = true;
  crashed = false;
  crashTimer = 0;
  stalled = false;

  readonly controls: ControlState = {
    aileron: 0, elevator: 0, rudder: 0, flaps: 0, spoilers: 0, gear: 1, steering: 0, throttle: 0,
  };
  flapTarget = 0;
  gearTarget = 1;

  gearHeight = 6;
  bellyHeight = 3;

  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);

  constructor(private readonly groundAt: (x: number, z: number) => number) {}

  reset(pos: THREE.Vector3, heading = 0) {
    this.position.copy(pos);
    this.quaternion.setFromAxisAngle(this.up, heading);
    this.speed = 0;
    this.sink = 0;
    this.onGround = true;
    this.crashed = false;
    this.stalled = false;
    Object.assign(this.controls, { aileron: 0, elevator: 0, rudder: 0, spoilers: 0, steering: 0, throttle: 0 });
    this.controls.gear = this.gearTarget = 1;
    this.controls.flaps = this.flapTarget = 0.5;
  }

  /** Current contact height above terrain (depends on gear position). */
  private contactHeight() {
    return THREE.MathUtils.lerp(this.bellyHeight, this.gearHeight, this.controls.gear);
  }

  get altitude() {
    return this.position.y - this.contactHeight() - this.groundAt(this.position.x, this.position.z);
  }

  get verticalSpeed() {
    return this.fwd.y * this.speed - this.sink;
  }

  step(input: PilotInput, dt: number) {
    const c = this.controls;
    if (this.crashed) {
      this.crashTimer += dt;
      this.speed *= Math.exp(-2 * dt);
      return;
    }

    // --- control surfaces & systems chase their commands ---
    const approach = (v: number, t: number, rate: number) => v + THREE.MathUtils.clamp(t - v, -rate * dt, rate * dt);
    c.elevator = approach(c.elevator, input.pitch, 3);
    c.aileron = approach(c.aileron, input.roll, 3);
    c.rudder = approach(c.rudder, input.yaw, 2);
    c.steering = approach(c.steering, this.onGround ? input.yaw : 0, 1.5);
    c.throttle = THREE.MathUtils.clamp(c.throttle + input.throttleDelta * dt, 0, 1);
    c.flaps = approach(c.flaps, this.flapTarget, 0.12);
    c.gear = approach(c.gear, this.gearTarget, 1 / 7);
    c.spoilers = approach(c.spoilers, input.brake ? 1 : 0, 2);

    this.fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    const pitchAngle = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
    const bank = Math.asin(THREE.MathUtils.clamp(-this.right.y, -1, 1));

    // --- speed ---
    const dragMul = 1 + c.flaps * 0.9 + c.spoilers * 1.4 + c.gear * 0.25;
    let accel = MAX_THRUST * c.throttle - DRAG * dragMul * this.speed * this.speed - G * Math.sin(pitchAngle);
    if (this.onGround) accel -= (input.brake ? 3.0 : 0.12) * Math.sign(this.speed);
    this.speed = Math.max(0, this.speed + accel * dt);

    // --- lift ---
    const vStall = THREE.MathUtils.lerp(STALL_CLEAN, STALL_FULL_FLAP, c.flaps);
    const liftRatio = (this.speed / vStall) ** 2 * Math.cos(bank) * (1 - 0.25 * c.spoilers);
    this.stalled = !this.onGround && liftRatio < 0.9;
    if (liftRatio < 1) this.sink += G * (1 - liftRatio) * dt;
    else this.sink = Math.max(0, this.sink - G * Math.min(1, liftRatio - 1 + 0.3) * dt);
    this.sink = Math.min(this.sink, 80);

    // --- attitude ---
    const eff = THREE.MathUtils.clamp(this.speed / 80, 0, 1.2);
    if (this.onGround) {
      // nosewheel steering fades out with speed, rudder takes over
      const steer = (0.35 * Math.max(0, 1 - this.speed / 60) + YAW_RATE * eff) * input.yaw;
      this.q.setFromAxisAngle(this.up, -steer * dt);
      this.quaternion.premultiply(this.q);
      // rotate only once there's enough air over the elevator
      if (eff > 0.75) this.rotateLocal(this.axisX, c.elevator * PITCH_RATE * 0.6 * eff * dt);
    } else {
      this.rotateLocal(this.axisX, c.elevator * PITCH_RATE * eff * dt);
      // clamp bank so the keyboard can't flip the airliner
      const rollCmd = c.aileron * ROLL_RATE * eff;
      if (!(bank > MAX_BANK && rollCmd > 0) && !(bank < -MAX_BANK && rollCmd < 0)) {
        this.rotateLocal(this.axisZ, -rollCmd * dt);
      }
      this.rotateLocal(this.up, -c.rudder * YAW_RATE * eff * dt);

      // coordinated turn from bank
      const turnRate = (G * Math.tan(bank)) / Math.max(this.speed, 50);
      this.q.setFromAxisAngle(this.up, -turnRate * dt);
      this.quaternion.premultiply(this.q);

      // positive stability: gentle roll-out with no aileron, nose drops when lift is missing
      if (Math.abs(input.roll) < 0.05) this.rotateLocal(this.axisZ, bank * 0.15 * dt);
      if (liftRatio < 1) this.rotateWorldPitch(-(1 - liftRatio) * 0.5 * dt);
    }
    this.quaternion.normalize();

    // --- integrate ---
    this.fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.position.addScaledVector(this.fwd, this.speed * dt);
    this.position.y -= this.sink * dt;

    // --- ground contact ---
    const ground = this.groundAt(this.position.x, this.position.z) + this.contactHeight();
    if (this.position.y <= ground) {
      const vs = this.fwd.y * this.speed - this.sink;
      this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
      const rollNow = Math.abs(Math.asin(THREE.MathUtils.clamp(this.right.y, -1, 1)));
      if (!this.onGround && (vs < -7 || rollNow > 0.3 || c.gear < 0.9)) {
        this.crashed = true;
        this.crashTimer = 0;
      }
      this.position.y = ground;
      this.onGround = true;
      this.sink = 0;
      this.levelOnGround(dt);
    } else if (this.position.y > ground + 0.5) {
      this.onGround = false;
    }
  }

  get crashReason() {
    return this.controls.gear < 0.9 ? 'Gear-up landing' : 'Crashed';
  }

  private rotateLocal(axis: THREE.Vector3, angle: number) {
    this.q.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(this.q);
  }

  /** Pitch about the aircraft's horizontal right axis (keeps heading intact). */
  private rotateWorldPitch(angle: number) {
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) return;
    this.q.setFromAxisAngle(this.right.normalize(), angle);
    this.quaternion.premultiply(this.q);
  }

  /** On the ground: wings level, nose not below the horizon. */
  private levelOnGround(dt: number) {
    const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    e.z *= Math.exp(-8 * dt);
    if (e.x < 0) e.x = 0;
    else e.x *= this.speed < 60 ? Math.exp(-2 * dt) : 1;
    this.quaternion.setFromEuler(e);
  }
}
