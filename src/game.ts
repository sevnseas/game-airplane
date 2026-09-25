import * as THREE from 'three';
import { Aircraft } from './aircraft';
import { FlightModel, type PilotInput } from './flight';
import { ATMOS, createClouds, createSky } from './sky';

/** A map the aircraft can fly in. */
export interface World {
  /** Adds scenery to the scene; resolves once everything needed to fly is ready. */
  build(scene: THREE.Scene, onProgress: (label: string) => void): Promise<void>;
  /** Height of the surface under (x, z), in metres. */
  groundAt(x: number, z: number): number;
  start: { position: THREE.Vector3; heading: number };
  cloudSpread: number;
}

export async function startGame(world: World) {

// ---- renderer / scene -------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(ATMOS.fog, 0.000045);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 80000);

const sky = createSky(1);
sky.scale.setScalar(60000);
scene.add(sky);

// image-based lighting from the same sky so metal/paint pick up the blue
{
  const envScene = new THREE.Scene();
  envScene.add(createSky(100));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 1, 1000).texture;
  scene.environmentIntensity = 0.6;
}

const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a6b3a, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(ATMOS.sunColor, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -60;
sc.right = sc.top = 60;
sc.near = 1;
sc.far = 800;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

scene.add(createClouds({ count: 140, spread: world.cloudSpread, base: 1400 }));

// ---- aircraft -----------------------------------------------------------------

const aircraft = new Aircraft();
const flight = new FlightModel(world.groundAt);

function resetFlight() {
  const { position, heading } = world.start;
  flight.reset(position.clone().setY(world.groundAt(position.x, position.z) + flight.gearHeight), heading);
  chaseHeading = heading;
}

const pct = document.getElementById('loading-pct')!;
try {
  await Promise.all([
    world.build(scene, (label) => (pct.textContent = label)),
    aircraft.load(`${import.meta.env.BASE_URL}models/a350.glb`, (p) => (pct.textContent = `A350 ${Math.round(p * 100)}%`)),
  ]);
} catch (e) {
  pct.textContent = `failed: ${e}`;
  throw e;
}
flight.gearHeight = aircraft.gearHeight;
flight.bellyHeight = aircraft.bellyHeight;
scene.add(aircraft.object);

// ---- input --------------------------------------------------------------------

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyG':
      flight.gearTarget = flight.gearTarget > 0.5 ? 0 : 1;
      break;
    case 'KeyV':
      flight.flapTarget = flight.flapTarget >= 1 ? 0 : Math.min(1, flight.flapTarget + 0.5);
      break;
    case 'KeyC':
      cam.mode = cam.mode === 'chase' ? 'free' : 'chase';
      if (cam.mode === 'free') cam.freePos.copy(camera.position);
      break;
    case 'Enter':
      resetFlight();
      break;
    case 'KeyH':
      document.getElementById('help')!.hidden = !document.getElementById('help')!.hidden;
      break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const axis = (neg: string[], pos: string[]) =>
  (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

function readPilot(): PilotInput {
  const free = cam.mode === 'free';
  return {
    pitch: free ? 0 : axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
    roll: free ? 0 : axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
    yaw: free ? 0 : axis(['KeyQ'], ['KeyE']),
    throttleDelta: free ? 0 : axis(['KeyF'], ['KeyR']) * 0.4,
    brake: !free && keys.has('KeyB'),
  };
}

// ---- camera: chase with mouse orbit, or free-fly --------------------------------

const cam = {
  mode: 'chase' as 'chase' | 'free',
  yaw: 0, // orbit offset around the aircraft
  pitch: 0.18,
  dist: 110,
  freePos: new THREE.Vector3(),
  freeYaw: 0,
  freePitch: 0,
  dragging: false,
  lastDrag: 0,
};

renderer.domElement.addEventListener('pointerdown', (e) => {
  cam.dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => (cam.dragging = false));
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!cam.dragging) return;
  cam.lastDrag = performance.now();
  if (cam.mode === 'chase') {
    cam.yaw -= e.movementX * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.004, -0.4, 1.4);
  } else {
    cam.freeYaw -= e.movementX * 0.003;
    cam.freePitch = THREE.MathUtils.clamp(cam.freePitch - e.movementY * 0.003, -1.5, 1.5);
  }
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * 0.001), 30, 2000);
  },
  { passive: true },
);

const heading = new THREE.Vector3();
const target = new THREE.Vector3();
const desired = new THREE.Vector3();
let chaseHeading = 0;

function updateCamera(dt: number) {
  if (cam.mode === 'free') {
    const speed = (keys.has('ShiftLeft') ? 1200 : 200) * dt;
    const look = new THREE.Euler(cam.freePitch, cam.freeYaw, 0, 'YXZ');
    const f = new THREE.Vector3(0, 0, -1).applyEuler(look);
    const r = new THREE.Vector3(1, 0, 0).applyEuler(look);
    cam.freePos.addScaledVector(f, axis(['KeyS'], ['KeyW']) * speed);
    cam.freePos.addScaledVector(r, axis(['KeyA'], ['KeyD']) * speed);
    cam.freePos.y += axis(['KeyQ'], ['KeyE']) * speed;
    camera.position.copy(cam.freePos);
    camera.quaternion.setFromEuler(look);
    return;
  }

  // drift the orbit back behind the aircraft a while after the mouse is released
  if (!cam.dragging && performance.now() - cam.lastDrag > 2500) {
    cam.yaw *= Math.exp(-1.2 * dt);
    cam.pitch += (0.18 - cam.pitch) * (1 - Math.exp(-1.2 * dt));
  }

  heading.set(0, 0, -1).applyQuaternion(flight.quaternion);
  const h = Math.atan2(-heading.x, -heading.z);
  // smooth heading follow, wrapped
  let dh = h - chaseHeading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  chaseHeading += dh * (1 - Math.exp(-3 * dt));

  const yaw = chaseHeading + cam.yaw;
  target.copy(flight.position).y += 6;
  desired.set(
    Math.sin(yaw) * Math.cos(cam.pitch),
    Math.sin(cam.pitch),
    Math.cos(yaw) * Math.cos(cam.pitch),
  ).multiplyScalar(cam.dist).add(target);
  camera.position.copy(desired);
  camera.lookAt(target);
}

// ---- HUD ----------------------------------------------------------------------------

const hud = {
  spd: document.getElementById('hud-spd')!,
  alt: document.getElementById('hud-alt')!,
  vs: document.getElementById('hud-vs')!,
  thr: document.getElementById('hud-thr')!,
  flap: document.getElementById('hud-flap')!,
  gear: document.getElementById('hud-gear')!,
  warn: document.getElementById('hud-warn')!,
};

function updateHud() {
  const c = flight.controls;
  hud.spd.textContent = (flight.speed * 1.944).toFixed(0);
  hud.alt.textContent = Math.max(0, flight.altitude * 3.281).toFixed(0);
  hud.vs.textContent = (flight.verticalSpeed * 196.85).toFixed(0);
  hud.thr.textContent = (c.throttle * 100).toFixed(0);
  hud.flap.textContent = ['UP', '1', 'FULL'][Math.round(flight.flapTarget * 2)];
  hud.gear.textContent = c.gear > 0.99 ? 'DOWN' : c.gear < 0.01 ? 'UP' : 'TRANSIT';
  hud.warn.textContent = flight.crashed
    ? `${flight.crashReason} — Enter to reset`
    : flight.stalled
      ? 'STALL'
      : !flight.onGround && flight.altitude < 300 && c.gear < 0.5 && flight.verticalSpeed < 0
        ? 'GEAR'
        : '';
}

// ---- loop -------------------------------------------------------------------------

const timer = new THREE.Timer();
function frame(time: number) {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);
  const pilot = readPilot();
  // substep the physics for stability at low frame rates
  const steps = Math.ceil(dt / (1 / 120));
  for (let i = 0; i < steps; i++) flight.step(pilot, dt / steps);

  aircraft.object.position.copy(flight.position);
  aircraft.object.quaternion.copy(flight.quaternion);
  aircraft.pose(flight.controls, dt);

  updateCamera(dt);
  sky.position.copy(camera.position);

  // keep the shadow frustum centred on the aircraft
  sun.target.position.copy(flight.position);
  sun.position.copy(flight.position).addScaledVector(ATMOS.sunDir, 400);

  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// debug handle for the console / headless checks
Object.assign(window, { game: { flight, aircraft, camera, scene, THREE } });

resetFlight();
document.getElementById('loading')!.remove();
requestAnimationFrame(frame);
}
