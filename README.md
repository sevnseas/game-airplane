# game-airplane

Browser flight game: an Airbus A350-1000 over procedural terrain, and a second scene at Chicago O'Hare (KORD, runway 28R). Three.js + Vite + TypeScript.

Live: https://sevnseas.github.io/game-airplane/ (O'Hare scene: https://sevnseas.github.io/game-airplane/ohare.html)

## Controls

W/S pitch (S = nose up), A/D roll, Q/E rudder / nosewheel steer, R/F throttle, V flaps, G gear, B brakes + spoilers. Drag to look, wheel to zoom, C chase / free camera, Enter reset, H hide help.

## Blender sources

The original Blender files that the in-game models are exported from live in `blender/`:

- `blender/a350/A350-1000.blend` - the A350-1000 aircraft (airframe, wings, engines, gear, control-surface rig, cabin, cockpit). See `blender/a350/README.md` for the control sliders and panel script.
- `blender/ohare/OHare.blend` - the O'Hare airport model, traced at 1:1 metres.

`public/models/a350.glb` is exported from the A350 file by `npm run export-model` (Windows Blender 5.2 from WSL, see `tools/export-model.sh`). It keeps only the exterior collections and the hinge rig, and freezes the drivers at their rest pose so the game can drive the control surfaces directly.

## Develop

```sh
npm install
npm run dev      # http://localhost:5180
npm run build    # dist/
```

## Deploy

Pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml`. In the repo settings, Pages > Source must be set to **GitHub Actions**.
