import * as THREE from 'three';
import { startGame } from './game';
import { createTerrain, heightAt, RUNWAY, WORLD_SIZE } from './terrain';

// Default map: procedural farmland and hills with a single runway along Z.
startGame({
  async build(scene) {
    scene.add(createTerrain());
  },
  groundAt: heightAt,
  start: { position: new THREE.Vector3(RUNWAY.x, 0, RUNWAY.z + RUNWAY.length / 2 - 120), heading: 0 },
  cloudSpread: WORLD_SIZE * 0.9,
});
