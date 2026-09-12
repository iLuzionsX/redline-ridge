# Texture Assets — Redline Ridge (Three.js racing game)

| File | Size | Source | License | Suggested use |
|---|---|---|---|---|
| `asphalt_01_1k.jpg` | 1024×1024, 739 KB | [Polyhaven — asphalt_01](https://polyhaven.com/a/asphalt_01) | CC0 1.0 | Road surface (repeat along track) |
| `sparse_grass_1k.jpg` | 1024×1024, 956 KB | [Polyhaven — sparse_grass](https://polyhaven.com/a/sparse_grass) | CC0 1.0 | Terrain/grass around track |
| `metal_plate_1k.jpg` | 1024×1024, 692 KB | [Polyhaven — metal_plate](https://polyhaven.com/a/metal_plate) | CC0 1.0 | Barriers, guard rails, signage |
| `noise_tile.png` | 256×256 grayscale, seamless | Generated locally (Python/PIL random noise, 128² tile mirrored 2×2) | CC0 1.0 | Grain/roughness overlay, dust particles, skid-mark alpha |

Total ~2.4 MB. All Polyhaven textures are CC0 — no attribution required.
Downloaded 2026-09-09 via the Polyhaven API
(`https://api.polyhaven.com/files/<id>` → `Diffuse / 1k / jpg` URLs on
`dl.polyhaven.org`), chosen for small web-friendly 1K resolution.

## Usage tips (Three.js)

- Set `texture.wrapS = texture.wrapT = THREE.RepeatWrapping` and repeat the
  asphalt texture along the track's UV `v` axis.
- Use `noise_tile.png` as a `roughnessMap` or as a subtle multiply overlay to
  break up tiling repetition on grass/asphalt.
- For the PS3 look, pair asphalt with `roughness: 0.55, metalness: 0.1` and a
  baked gradient env map for sun streaks (see graphics spec).
