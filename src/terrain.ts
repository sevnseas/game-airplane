import * as THREE from 'three';

/**
 * Ground: a large displaced plane that stays flat around the airfield and
 * rolls into hills further out. Colour comes from a painted patchwork of
 * fields (macro texture) modulated by a tiling noise texture (detail) in
 * world space, so it reads at both 10 km and 10 m.
 */

export const WORLD_SIZE = 40000;
export const RUNWAY = { length: 3600, width: 60, x: 0, z: 0 };

// ---- deterministic value noise shared by mesh and physics ----------------

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Value noise; with `period` set, the lattice wraps so textures tile. */
function noise(x: number, z: number, period = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const w = (n: number) => (period ? ((n % period) + period) % period : n);
  const a = hash(w(xi), w(zi)), b = hash(w(xi + 1), w(zi));
  const c = hash(w(xi), w(zi + 1)), d = hash(w(xi + 1), w(zi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, z: number): number {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) {
    sum += amp * noise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export type HeightFn = (x: number, z: number) => number;

/**
 * Terrain height function: flat inside a rectangular pad of half-size
 * (padX, padZ) around the origin, ramping into hills scaled by `relief`.
 */
export function makeHeightFn(padX: number, padZ: number, relief = 1): HeightFn {
  return (x, z) => {
    const dx = Math.max(0, Math.abs(x) - padX);
    const dz = Math.max(0, Math.abs(z) - padZ);
    const ramp = THREE.MathUtils.smoothstep(Math.hypot(dx, dz), 0, 3500);
    const hills = fbm(x / 2600 + 13.1, z / 2600 - 7.3);
    const ridges = Math.pow(fbm(x / 7000 - 3.0, z / 7000 + 5.0), 2.0);
    return ramp * relief * (hills * 260 + ridges * 900 - 90);
  };
}

/** The default map: runway along Z with an 800 m flat margin. */
export const heightAt = makeHeightFn(800, RUNWAY.length / 2 + 800);

// ---- textures -------------------------------------------------------------

function fieldsTexture(size = 2048): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const palette = ['#5f7f3a', '#6d8c3f', '#7a9448', '#8f9a4f', '#a79c5a', '#56733a', '#4b6a34', '#83733f', '#6a8a4a'];
  g.fillStyle = '#627f3c';
  g.fillRect(0, 0, size, size);

  // recursively split into fields, like a patchwork of farmland
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    if (depth > 6 || (depth > 3 && Math.random() < 0.25) || w < 40 || h < 40) {
      g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      // crop rows
      if (Math.random() < 0.5) {
        g.globalAlpha = 0.08;
        g.strokeStyle = '#000';
        const vertical = w < h;
        for (let i = 3; i < (vertical ? w : h); i += 4) {
          g.beginPath();
          if (vertical) { g.moveTo(x + i, y); g.lineTo(x + i, y + h); }
          else { g.moveTo(x, y + i); g.lineTo(x + w, y + i); }
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      return;
    }
    const t = 0.3 + Math.random() * 0.4;
    if (w > h) {
      split(x, y, w * t, h, depth + 1);
      split(x + w * t, y, w * (1 - t), h, depth + 1);
    } else {
      split(x, y, w, h * t, depth + 1);
      split(x, y + h * t, w, h * (1 - t), depth + 1);
    }
  };
  const cells = 4;
  const cs = size / cells;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) split(i * cs, j * cs, cs, cs, 0);

  // woodland blobs
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 15 + Math.random() * 60;
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(${40 + Math.random() * 15},${62 + Math.random() * 15},${32},0.85)`;
      g.beginPath();
      g.arc(x + (Math.random() - 0.5) * r * 1.6, y + (Math.random() - 0.5) * r * 1.6, r * (0.3 + Math.random() * 0.5), 0, Math.PI * 2);
      g.fill();
    }
  }

  // country roads
  g.strokeStyle = 'rgba(170,160,140,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    g.beginPath();
    let x = Math.random() * size, y = 0;
    g.moveTo(x, y);
    while (y < size) {
      y += 60 + Math.random() * 120;
      x += (Math.random() - 0.5) * 160;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function detailTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        0.5 * noise((x / size) * 8, (y / size) * 8, 8) +
        0.3 * noise((x / size) * 32, (y / size) * 32, 32) +
        0.2 * Math.random();
      const v = Math.floor(100 + n * 155);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function runwayTexture(): THREE.CanvasTexture {
  // 1 px ≈ 0.5 m across, texture repeats along the runway
  const w = 128, h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d3f42';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // edge lines
  g.fillStyle = '#e8e8e2';
  g.fillRect(2, 0, 2, h);
  g.fillRect(w - 4, 0, 2, h);
  // centerline dashes: 30 m dash / 20 m gap scaled into the tile
  g.fillRect(w / 2 - 1, 0, 2, h * 0.6);
  // tyre marks
  g.fillStyle = 'rgba(20,20,20,0.25)';
  g.fillRect(w / 2 - 20, 0, 10, h);
  g.fillRect(w / 2 + 10, 0, 10, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- meshes ---------------------------------------------------------------

export function createTerrain(height: HeightFn = heightAt, opts = { airfield: true, groundOffset: -0.25 }): THREE.Group {
  const group = new THREE.Group();

  const segs = 320;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const macro = fieldsTexture();
  macro.repeat.set(WORLD_SIZE / 5000, WORLD_SIZE / 5000);
  const detail = detailTexture();

  const mat = new THREE.MeshStandardMaterial({ map: macro, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D uDetail;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        float d1 = texture2D(uDetail, vWorldPos.xz / 24.0).r;
        float d2 = texture2D(uDetail, vWorldPos.xz / 190.0).r;
        diffuseColor.rgb *= mix(0.7, 1.25, d1 * 0.5 + d2 * 0.5);
        // rock on high ground, snow-ish caps on the ridges
        float high = smoothstep(450.0, 800.0, vWorldPos.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.40, 0.36) * (0.8 + d1 * 0.4), clamp(high * 0.8, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), smoothstep(780.0, 900.0, vWorldPos.y));
        `,
      );
  };

  const ground = new THREE.Mesh(geo, mat);
  ground.position.y = opts.groundOffset; // keep pavement (y=0) visibly above the grass
  ground.receiveShadow = true;
  group.add(ground);
  if (!opts.airfield) return group;

  // runway + a big grey apron beside it
  const rwTex = runwayTexture();
  rwTex.repeat.set(1, RUNWAY.length / 60);
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length),
    new THREE.MeshStandardMaterial({
      map: rwTex,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(RUNWAY.x, 0, RUNWAY.z);
  runway.receiveShadow = true;
  group.add(runway);

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x8f918c,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 700), concrete);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-260, -0.1, 300);
  apron.receiveShadow = true;
  group.add(apron);
  for (const z of [-900, 300, 1500]) {
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(150, 25), concrete);
    taxi.rotation.x = -Math.PI / 2;
    taxi.position.set(-105, -0.1, z);
    taxi.receiveShadow = true;
    group.add(taxi);
  }
  const taxiway = new THREE.Mesh(new THREE.PlaneGeometry(25, RUNWAY.length - 200), concrete);
  taxiway.rotation.x = -Math.PI / 2;
  taxiway.position.set(-170, -0.1, 0);
  taxiway.receiveShadow = true;
  group.add(taxiway);

  // a couple of hangars and a tower so there is some scale reference
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(90, 28, 80), hangarMat);
    hangar.position.set(-420, 14, 50 + i * 110);
    hangar.castShadow = hangar.receiveShadow = true;
    group.add(hangar);
  }
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 40, 16), hangarMat);
  shaft.position.y = 20;
  const cab = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 6, 7, 16),
    new THREE.MeshStandardMaterial({ color: 0x2b4a60, roughness: 0.15, metalness: 0.6 }),
  );
  cab.position.y = 43;
  tower.add(shaft, cab);
  tower.position.set(-400, 0, 700);
  tower.traverse((o) => (o.castShadow = true));
  group.add(tower);

  return group;
}
