import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { startGame } from './game';
import { createTerrain, makeHeightFn, WORLD_SIZE } from './terrain';

/**
 * O'Hare (ORD), from blender/ohare/OHare.blend (exported to
 * public/models). The model is traced at 1:1 metres: runway lengths match the
 * real airfield within ±4% (10L/28R = 3962 m = 13,000 ft).
 * Blender X east / Y north → three +X east / −Z north.
 *
 * Paving is layered sheets (grass 0, apron 0.18, shoulder 0.44, taxiway 0.58,
 * runway 0.62), so ground contact raycasts down onto those meshes.
 */

// Outside the airport the procedural terrain takes over: flat Illinois with
// only very gentle relief far out.
const surround = makeHeightFn(3600, 3800, 0.15);

// GLTFLoader sanitizes node names (spaces → underscores)
const GROUND_MESHES = /Terrain|Runway_asphalt|Taxiway_concrete|Apron_concrete|Runway_shoulder|Airfield_readability_\|_Service_road/;

const groundMeshes: THREE.Mesh[] = [];
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();
const hits: THREE.Intersection[] = [];
let airportBox = new THREE.Box3();
// the flight model asks several times per frame for nearly the same spot
let cacheX = NaN, cacheZ = NaN, cacheH = 0;

function groundAt(x: number, z: number): number {
  if (Math.abs(x - cacheX) < 0.25 && Math.abs(z - cacheZ) < 0.25) return cacheH;
  let h = surround(x, z) - 0.3;
  if (x > airportBox.min.x && x < airportBox.max.x && z > airportBox.min.z && z < airportBox.max.z) {
    origin.set(x, 200, z);
    ray.set(origin, down);
    ray.far = 400;
    hits.length = 0;
    ray.intersectObjects(groundMeshes, false, hits);
    if (hits.length) h = hits[0].point.y;
  }
  cacheX = x;
  cacheZ = z;
  cacheH = h;
  return h;
}

// 28R: east end of 10L/28R, lined up heading west.
const RWY_28R_EAST = 2119.7;
const RWY_28R_Z = 1081; // Blender y = −1081

startGame({
  async build(scene, progress) {
    scene.add(createTerrain(surround, { airfield: false, groundOffset: -0.3 }));
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/ohare.glb`, (e) => {
      if (e.total) progress(`O'Hare ${Math.round((e.loaded / e.total) * 100)}%`);
    });
    const ohare = gltf.scene;
    ohare.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = /Terminals|Gate|Landside|Details|Architectural/.test(mesh.name);
      if (GROUND_MESHES.test(mesh.name)) {
        groundMeshes.push(mesh);
        (mesh.material as THREE.Material).side = THREE.DoubleSide; // raycast hits either winding
      }
    });
    scene.add(ohare);
    ohare.updateMatrixWorld(true);
    airportBox = new THREE.Box3().setFromObject(ohare);
    console.log('ohare ground meshes', groundMeshes.map((m) => m.name), 'bounds', airportBox);
  },
  groundAt,
  start: { position: new THREE.Vector3(RWY_28R_EAST - 150, 0, RWY_28R_Z), heading: Math.PI / 2 },
  cloudSpread: WORLD_SIZE * 0.9,
});
