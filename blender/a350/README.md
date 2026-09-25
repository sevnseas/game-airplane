# Airbus A350-1000 — Blender aircraft

Open **A350-1000.blend** in Blender 5.2 or newer. Units are meters; the nose points along −X. All aircraft parts are parented to **A350 FLIGHT CONTROLS**, so moving or rotating that object moves the aircraft.

## Controls and interior access

1. Select **A350 FLIGHT CONTROLS**. Open **Object Properties → Custom Properties**. Sliders control ailerons, elevator, rudder, flaps, spoilers, gear, doors, throttle/fans and nosewheel steering.
2. For a friendlier panel, open Blender's **Text Editor**, select **A350 Controls UI - Run Script.py**, and press **Run Script**. The 3D View's **N sidebar → A350** gains sliders and camera buttons. This is bundled local source code, also available at `../scripts/a350/controls_panel.py`.
3. The timeline includes a mechanical demonstration at frames **1–320**. Markers identify the configurations. To pose the aircraft manually without the demonstration changing the values, click **Use manual controls** in the A350 panel. The original action stays in the file.
4. Choose **03 Cabin walk-in**, **04 Cockpit overview**, or **05 Captain eye** in the panel. Press **Shift + `** over the viewport to enter Blender Walk Navigation; use **W/A/S/D**, **Q/E**, and the mouse. Left-click accepts the viewpoint; Esc cancels. Walk navigation is Blender's viewport facility, not a game collision controller.
5. Set **cutaway = 1** to hide the outer pressure shell, glazing, cabin lining, ceiling and bins for inspection. Set it back to 0 for exterior renders.

`gear = 1` is extended; `gear = 0` is retracted. The flaps control also deploys the inboard droop nose and six outboard slats per wing. Main gear bay doors open during transit and close at either endpoint. Other unsigned controls use 0–1. Aileron, elevator, rudder and steering use −1–1. The root object can be animated for taxi or flight paths.

## Contents

- Metric A350-1000 airframe, swept airfoil wings, curved tips and separate flight-control surfaces.
- Two hollow Trent XWB-inspired nacelles, inlet liners, 22 blades per fan and exhaust cores.
- Two articulated six-wheel main bogies and twin nose wheels, tracking struts, fitted gear bays, and animated doors.
- Passenger deck, illustrative premium and nine-abreast economy seating, bins, lighting, galleys and basic aft lavatory fittings.
- Basic cockpit with six displays and packed screen graphics, seats, sidesticks, thrust levers, FCU, overhead switches and rudder pedals.
- Editable materials, named collections, interior cameras and a mechanical demonstration action.

The aircraft is a visualization model. The cabin is an illustrative layout rather than a specific airline configuration. Cockpit displays are static illustrations; this does not implement avionics, flight dynamics or certified control limits.

## Rebuild

Run `scripts/a350/panel_art.py` with Python and Pillow to regenerate the authored display images. Then:

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/build_a350.py
blender --background --python scripts/a350/verify.py
```

Add `-- --no-render` to the rebuild command to skip renders. The complete rebuild runs the base authoring, fit, mechanical and delivery passes, followed by saved-file verification.

The build saves the editable `.blend` before rendering exterior, cabin and cockpit views to `renders/`. Render filenames beginning `iteration-` are retained review evidence, not the current model. `references.md` records the online sources; `verification.json` records checks on the reopened deliverable.
