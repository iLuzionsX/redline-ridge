# Redline Ridge — Third-Party Asset Credits

This file lists every third-party asset used in the game and the credit its
license requires. **CC-BY licenses REQUIRE the attribution line to appear in
the game's credits screen / about page.** CC0 assets need no credit but are
listed here for completeness.

---

## Required attributions (CC-BY — must appear in-game)

### 1. Player car — BMW G90 M5 (silver repaint in-game)
- **Asset:** BMW G90 M5 (optimized game version: `bmw-g90-m5-game.glb`, 53,739 tris)
- **Author:** JUSTGAME
- **Source:** https://sketchfab.com/3d-models/bmw-g90-m5-9dc9e5c88bec4faa94552fdd0b76ed21
- **License:** CC-BY 4.0
- **Required credit line:** `BMW G90 M5 by JUSTGAME, CC-BY 4.0, via Sketchfab`

### 2. Tire stack prop
- **Asset:** "Tire" (`tire_poly-google.glb`)
- **Author:** Poly by Google (Google Poly archive, via poly.pizza)
- **Source:** https://poly.pizza/m/1Jr3nTJEMOu
- **License:** CC-BY 3.0
- **Required credit line:** `"Tire" by Poly by Google (https://poly.pizza/m/1Jr3nTJEMOu), CC-BY 3.0`

### 3. Engine sound loop
- **Asset:** "Car Engine Loop 96kHz, 4s" (`engine_loop.mp3/.ogg`)
- **Author:** qubodup
- **Source:** https://opengameart.org/content/car-engine-loop-96khz-4s
- **License:** CC-BY 3.0
- **Required credit line:** `Engine loop: "Car Engine Loop" by qubodup, CC-BY 3.0`

### 4. Crowd cheering
- **Asset:** "Free Crowd Cheering Sounds" (`crowd_cheer.mp3/.ogg`, "03 - Strong cheering - I", trimmed to 8 s)
- **Author:** Gregor Quendel
- **Source:** http://opengameart.org/content/free-crowd-cheering-sounds
- **License:** CC-BY 4.0
- **Required credit line:** `Crowd cheering: Gregor Quendel, CC-BY 4.0`

---

## CC0 assets (no credit required, listed for completeness)

### Cars — AI rivals (CC0)
- **Kenney Car Kit v3.1** by Kenney (https://kenney.nl/assets/car-kit): `hatchback-sports.glb`, `sedan-sports.glb`, `suv-luxury.glb`, `taxi.glb`, plus shared `colormap.png`. CC0 1.0 — crediting Kenney / www.kenney.nl appreciated but not required.
- **Kenney Racing Kit** by Kenney (https://kenney.nl/assets/racing-kit): `raceCarRed.glb`, `raceCarGreen.glb`. CC0 1.0.

### Track assets (CC0)
- **Kenney Racing Kit** by Kenney (https://kenney.nl/assets/racing-kit): road tiles, rails, fences, barriers, gantries, flags, pylons, grandstand, light posts, tents, billboards, trees, grass — all except the two below. CC0 1.0.
- **"Traffic Cone"** by Quaternius (https://poly.pizza/m/aDIrUbMbW3): `cone_traffic_quaternius.glb`. CC0.

### Environment (CC0)
- **Kenney Racing Kit** (https://github.com/KenneyNL/Starter-Kit-Racing): track pieces, tents, decorations, trucks.
- **Kenney City Kit** (https://github.com/KenneyNL/Starter-Kit-City-Builder): buildings, trees, grass, roads, pavement.
- **Kenney Nature Kit** (via https://github.com/brendengreenwood/hanks-homestead): trees, rocks, bushes, grass, flowers.
- **Quaternius** (via https://github.com/herval/gta5-rj-fable5): rigged/animated crowd characters.
- All CC0 1.0.

### Nature textures (CC0)
- **ambientCG** (https://ambientcg.com), photogrammetry by Lennart Demes / contributors: `grass-meadow` (Grass 004), `dirt-trail` (Ground 103), `bark-conifer` (Bark 014), `rock-cliff` (Rock 058), `forest-floor` (Ground 106) — 2K PBR albedo/normal/roughness. CC0 1.0. No credit required.

### Road textures (CC0)
- **ambientCG** (https://ambientcg.com): `asphalt-clean` (Asphalt 033), `asphalt-marked` (Road 007), `concrete` (Concrete 034), `metal-guardrail` (Metal 032) — 2K PBR. CC0 1.0. No credit required.

### General textures (CC0)
- **Poly Haven** (https://polyhaven.com): `asphalt_01`, `sparse_grass`, `metal_plate` (1K), and `kloppenheim_06_puresky` equirectangular sky. CC0 1.0. No credit required.
- **ambientCG** (https://ambientcg.com): Grass005, Rock064, Asphalt033 (1K PBR, in `environment/terrain/`). CC0 1.0.
- `noise_tile.png` — generated locally (Python/PIL), CC0 1.0.

### Mountain road map (CC0)
- **Procedurally generated in-house** (Python + numpy + PIL, seed 7): heightmap, road mask, terrain diffuse, road spline (~1.59 km closed loop), asphalt tile. CC0 1.0 — no third-party assets, no credit required.

### Audio (CC0)
- **Skid loop** ("Car tire squeal skid loop", https://opengameart.org/node/6596) — audible-edge (Tom Haigh), submitted by qubodup. CC0 1.0.
- **Crash** ("Crash Collision", https://opengameart.org/content/crash-collision) — qubodup. CC0 1.0.
- **Race countdown** ("Race Start Countdown", https://opengameart.org/node/172775) — kheetor. Listed as CC0 1.0 (see "verify" below).

---

## Code libraries (informational)
- **Three.js** — https://threejs.org — MIT License.
- **cannon-es** — https://github.com/pmndrs/cannon-es — MIT License.

---

## ⚠️ Verify (uncertain — do not ship without checking)
1. **Race countdown (kheetor):** the asset README records it as "CC0 1.0 (author also offers CC-BY; treated as CC0)". The dual-license wording is ambiguous — confirm on the OpenGameArt page (https://opengameart.org/node/172775) whether CC0-only use is permitted before release, or credit as CC-BY to be safe.
2. **Kenney redistribution mirrors:** several Kenney GLBs were pulled from third-party GitHub mirrors (e.g. `DRemensp/lanerunner`, `rakesh-ranj/lane-dash`, `herval/gta5-rj-fable5`, `brendengreenwood/hanks-homestead`) rather than kenney.nl directly. The files are documented as unmodified Kenney CC0 originals, but a spot-check of one model against an official Kenney release is recommended.

---

*Compiled 2026-09-09 for artifact `racing-game`. Sources: per-folder README.md / License.txt files under `~/workspace/racing-game-assets/`.*
