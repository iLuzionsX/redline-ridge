# Redline Ridge — Asset Attribution

All third-party assets below were license-verified at download time (2026-09-23).
**CC0-1.0** assets require no credit but are listed for completeness.
**CC-BY-4.0** assets REQUIRE the listed attribution line in the game's credits screen / about page.

Substitutions vs. the original manifest are marked [SUB].

## Cars

### assets/cars/player.glb
- Source: extracted from this repo's git history (`main:index.html` embedded base64 glTF, ~264KB blob)
- Original author: JUSTGAME — https://sketchfab.com/3d-models/bmw-g90-m5-9dc9e5c88bec4faa94552fdd0b76ed21
- License: CC-BY-4.0
- Required credit: `BMW G90 M5 by JUSTGAME, CC-BY 4.0, via Sketchfab`

### assets/cars/rival-a.glb
- Source: "Free, Low Poly 3D Race car model" — https://opengameart.org/node/172295 (file `RaceCar.glb` from `racecar.zip`)
- Author: mabaci
- License: CC0-1.0 (confirmed in the zip's `License.txt` and the OGA page)

### assets/cars/rival-b.glb
- Source: Khronos glTF Sample Assets, "ToyCar" — https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar
- Authors: Guido Odendahl (initial car model); Eric Chadwick (extensions and scene composition)
- License: CC0-1.0 (per the model's README `## Legal` section)

## Environment

### assets/env/sky-sunset.jpg
- Source: Poly Haven HDRI "bambanani_sunset" (tonemapped JPG, downscaled to 2048×1024) — https://polyhaven.com/a/bambanani_sunset
- Authors: Dimitrios Savva (photography), Jarod Guest (processing)
- License: CC0-1.0 — https://polyhaven.com/license

### assets/env/road/albedo.jpg, roughness.jpg, normal.jpg
- Source: Poly Haven texture "asphalt_track" (1K, Diffuse/Rough/nor_gl) — https://polyhaven.com/a/asphalt_track
- Author: Dimitrios Savva
- License: CC0-1.0

### assets/env/terrain-grass.jpg, terrain-grass-normal.jpg
- Source: Poly Haven texture "grass_ground" (1K, Diffuse/nor_gl) — https://polyhaven.com/a/grass_ground
- Author: Charlotte Baglioni
- License: CC0-1.0

### assets/env/terrain-rock.jpg, terrain-rock-normal.jpg
- Source: Poly Haven texture "dark_rock" (1K, Diffuse/nor_gl) — https://polyhaven.com/a/dark_rock
- Author: Amal Kumar
- License: CC0-1.0

### assets/env/tree-pine-a.glb
- Source: "low-poly-pine-tree-0" (`pinetree.obj`, converted OBJ→GLB, MTL colors preserved) — https://opengameart.org/content/low-poly-pine-tree-0
- Author: Aredon
- License: CC0-1.0

### assets/env/tree-pine-b.glb
- Source: "low-polygon-pine-tree" (`LowPolyTree/tree.obj`, converted OBJ→GLB, Bark/TreeLeaves MTL colors preserved) — https://opengameart.org/content/low-polygon-pine-tree
- Author: Texasfunk101
- License: CC0-1.0

### assets/env/rock-a.glb
- Source: Poly Haven model "moon_rock_01" (packed gltf+textures→GLB, textures at 512px) — https://polyhaven.com/a/moon_rock_01
- Authors: Greg Zaal, Rico Cilliers (photography); Jenelle van Heerden, Dario Barresi (processing)
- License: CC0-1.0

### assets/env/rock-b.glb
- Source: Poly Haven model "moon_rock_02" (packed gltf+textures→GLB, textures at 512px) — https://polyhaven.com/a/moon_rock_02
- Authors: Rico Cilliers, Greg Zaal (photography); Jenelle van Heerden (processing)
- License: CC0-1.0

### assets/env/guardrail.glb  [SUB]
- Source: Poly Haven model "concrete_road_barrier" (packed gltf+textures→GLB, textures at 512px) — https://polyhaven.com/a/concrete_road_barrier
- Author: Amal Kumar
- License: CC0-1.0
- Note: no CC0 metal W-beam guardrail model could be found (the one OGA "Guardrail" entry is CC-BY-SA/GPL — excluded). Substituted with a scanned concrete road barrier, which serves the same track-edge role.

### assets/env/banner-a.png, assets/env/banner-b.png, assets/env/sign-chevron.png
- Original artwork created for this project (PIL-rendered): fictional sponsors "REDLINE RIDGE Grand Prix" and "APEX TURBO CUP", plus a black-on-yellow chevron corner sign. No real brands. No third-party source, no attribution required.

### assets/env/building-a.glb  [SUB]
- Source: Kenney City Kit (Suburban), `building-type-f.glb` (palette texture embedded) — https://kenney.nl/assets/city-kit-suburban
- Author: Kenney
- License: CC0-1.0
- Note: no verified freely-licensed realistic alpine chalet found (OGA chalet entries are CC-BY-SA/GPL — excluded). Substituted with a Kenney suburban house (stylized but license-clean) as the trackside building.

### assets/env/mountain-far.glb
- Source: Poly Haven model "mountainside" (packed gltf+textures→GLB, textures at 512px) — https://polyhaven.com/a/mountainside
- Authors: Dario Barresi (photography), Rico Cilliers (processing)
- License: CC0-1.0
- Note: 153k-tri scanned mesh, ~10m native size — scale up in-game for the distant mountain backdrop.

## License verification method
- Poly Haven: https://polyhaven.com/license (site-wide CC0-1.0); authors from the official API.
- OpenGameArt: per-page `License(s): CC0` field + bundled `License.txt` where present; CC-BY-SA/GPL entries rejected.
- Khronos glTF-Sample-Assets: per-model README `## Legal` section.
- Kenney: https://kenney.nl (all kits CC0).
- Sketchfab (BMW G90): prior project's CREDITS.md records CC-BY-4.0 with required credit line; re-verification of the live Sketchfab page was not possible from this sandbox, so keep the credit line as recorded.
