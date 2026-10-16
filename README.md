# cub3d-web

A browser port of [cub3D](https://github.com/Simonization/cub3D), the 42 raycaster
Simon Langerock and `agoldber` wrote in C with MiniLibX — rebuilt so it can be played
from a link, and edited from inside itself.

Press **M** for a terminal where you draw the map: pick a brush (wall `1`, floor `0`,
outside, or you) and click or drag on the grid. Press **C** for one where you set the
floor and ceiling colours channel by channel and give each of the four walls its own
image. Both screens explain what they are doing while you use them, and both close with
`:w` (write — save and play) or `:q` (quit — leave without saving), typed or clicked.

Then there are four levels and something behind a door marked THE END. **Esc** (or **≡**
on a phone) brings back the start screen, where you can jump to any of them; the sandbox
keeps your map while you are away.
[How the monsters work](public/making-of.html) is the long version: what DOOM actually
did in 1993, and what this does instead.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
```

## How faithful is it?

The renderer is a direct port of `src/draw_ray/draw_ray.c`: same DDA, same camera-plane
ray setup, same rule for which of the four wall textures a face gets, same texture-X
mirroring. The `.cub` parser is a port of `src/parse/*.c` down to the error strings, and
`scripts/parity-fuzz.py` differential-tests it against a harness built from the real C —
600 generated maps, no disagreements.

Seven quirks in the C were fixed rather than reproduced, because they are bugs rather
than behaviour: the hardcoded `HEIGHT - 360` horizon, the field of view changing the
instant you first rotate, diagonals moving √2 faster, frame-rate-dependent movement
speed, a `put_pixel` bounds check using `>` instead of `>=`, texture row 0 never being
sampled, and a DDA with no bounds check. `main.c` also treats a floor or ceiling colour
of `0,0,0` as "not set" and refuses to start; here black is a colour like any other.

Distances are in tile units rather than the C's 64-pixel blocks, and there is a
per-column depth buffer the C has no equivalent of — the enemies need it to be clipped
behind pillars.

## Hitting things

A shot is a ray; each enemy is a circle. With `dir` the unit vector you face and `v` the
vector to the enemy, `v · dir` is how far down the ray it sits and
`|v.x*dir.y − v.y*dir.x|` is how far to the *side* of it — so that second number is
literally "by how much did I miss", and comparing the first against the wall distance is
what stops shots going through walls. `src/game/weapon.ts`, tested in `weapon.test.ts`.

## Layout

```
assets/xpm/         the original XPM art, kept so conversion is reproducible
scripts/xpm2png.py  XPM -> PNG (Pillow cannot read these: named X11 colours, 2 chars/pixel)
scripts/parity-*    differential test against the C parser
scripts/smoke.mjs   drives the real page in Chromium
src/engine/         framebuffer, raycaster, player, textures, input
src/format/         the .cub parser and validator
src/editor/         the M and C screens
```

## Tests

```sh
npm test                                          # unit + parity fixtures
node scripts/smoke.mjs http://localhost:5173 shots
python3 scripts/parity-fuzz.py ./parity ../cub3D  # needs the C harness built
```

## Credits

The C original is by **Simon Langerock** and **agoldber**. Wall textures and the weapon
flipbook come from that repository.
