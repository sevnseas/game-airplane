import * as THREE from 'three';

/**
 * Daytime atmosphere: gradient sky dome with a sun disc and horizon haze,
 * matching exponential fog, and a layer of sprite cumulus clouds.
 */

export const ATMOS = {
  zenith: new THREE.Color(0x2a64b8),
  mid: new THREE.Color(0x6fa8e0),
  horizon: new THREE.Color(0xd4e6f4),
  fog: new THREE.Color(0xbcd4e8),
  sunDir: new THREE.Vector3(-0.45, 0.62, -0.55).normalize(),
  sunColor: new THREE.Color(0xfff1dc),
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // three-stop vertical gradient, compressed toward the horizon
    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.18, h));
    col = mix(col, uZenith, smoothstep(0.12, 0.85, h));

    // below the horizon fade to the haze colour so the ground edge blends
    col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.08, h));

    // Mie-ish glow around the sun + the disc itself
    float sd = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * pow(sd, 6.0) * 0.22;
    col += uSunColor * pow(sd, 64.0) * 0.35;
    col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 4.0;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky(radius = 1): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: ATMOS.zenith },
      uMid: { value: ATMOS.mid },
      uHorizon: { value: ATMOS.horizon },
      uSunDir: { value: ATMOS.sunDir },
      uSunColor: { value: ATMOS.sunColor },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  return sky;
}

/** Soft round puff used by every cloud sprite. */
function puffTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  // several offset blobs so puffs aren't perfect circles
  for (let i = 0; i < 7; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.3;
    const y = s / 2 + (Math.random() - 0.5) * s * 0.2;
    const r = s * (0.22 + Math.random() * 0.18);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Scattered cumulus: each cloud is a cluster of camera-facing sprites with a
 * flat-ish bright top and a shaded base.
 */
export function createClouds(opts: { count: number; spread: number; base: number }): THREE.Group {
  const group = new THREE.Group();
  const tex = puffTexture();
  const top = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, depthWrite: false, fog: true });
  const mid = new THREE.SpriteMaterial({ map: tex, color: 0xe6ebf2, depthWrite: false, fog: true });
  const bottom = new THREE.SpriteMaterial({ map: tex, color: 0xb9c3d0, depthWrite: false, fog: true });

  for (let i = 0; i < opts.count; i++) {
    const cloud = new THREE.Group();
    const size = 250 + Math.random() * 650;
    cloud.position.set(
      (Math.random() - 0.5) * opts.spread,
      opts.base + Math.random() * 500,
      (Math.random() - 0.5) * opts.spread,
    );
    const puffs = 8 + Math.floor(Math.random() * 10);
    for (let p = 0; p < puffs; p++) {
      const v = Math.random();
      const sp = new THREE.Sprite(v > 0.66 ? top : v > 0.25 ? mid : bottom);
      const ps = size * (0.5 + Math.random() * 0.6);
      sp.scale.set(ps, ps * 0.8, 1);
      sp.position.set(
        (Math.random() - 0.5) * size * 1.6,
        (v - 0.3) * size * 0.45,
        (Math.random() - 0.5) * size * 1.2,
      );
      cloud.add(sp);
    }
    group.add(cloud);
  }
  return group;
}
