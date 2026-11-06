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
src/bugs/           the "Bugs & ideas" panel on the start screen
server/             the bug board API (Node built-ins only, no build step)
scripts/bugs.mjs    list / delete bug reports from a terminal
deploy/             Caddy block, systemd unit, deploy script
```

## Tests

```sh
npm test                                          # unit + parity fixtures
node scripts/smoke.mjs http://localhost:5173 shots
python3 scripts/parity-fuzz.py ./parity ../cub3D  # needs the C harness built
```

## Bug board

The start screen has a **Bugs & ideas** button: a short form (bug or idea, a message,
an optional name) and the public list of everything already reported. It is the only
part of the site with a backend: `server/index.mjs`, a dependency-free Node service that
keeps the reports in one JSON file (written to a temp file, fsynced, renamed — so a
crash never leaves half a file). Caddy sends `/api/*` to it on `127.0.0.1:8787`.

| Endpoint | |
| --- | --- |
| `GET /api/bugs` | every report, newest first (no IPs are stored or returned) |
| `POST /api/bugs` | `{type: "bug" \| "suggestion", message, name?}` — 3–500 characters, name ≤ 40 |
| `DELETE /api/bugs/:id` | needs `Authorization: Bearer <BUGS_ADMIN_KEY>` |
| `GET /api/health` | `{ok, reports}` |

Guards: 4 KB body cap, JSON only, control/bidi characters stripped, 5 posts per 10
minutes per IP, 10 wrong admin keys per 15 minutes per IP, exact duplicates refused,
500 reports max, a honeypot field for bots. The page puts every report on screen with
`textContent`, never `innerHTML`. If the API is down the panel says so and the game is
unaffected. Tests: `server/core.test.mjs`.

**Removing fixed reports** — no login, two ways, both using the same key:

- Admin link: `https://play.langerock.xyz/bugs/admin#key=<KEY>` opens the panel with a
  delete button on each report. `npm run bugs -- link` prints it. Use `#key=`, not
  `?key=`: a fragment never leaves the browser, so the key never reaches Caddy's access
  log (`?key=` works too, but gets logged). The page wipes the key from the address bar.
- CLI: `npm run bugs -- list`, `npm run bugs -- rm 12 13`. It reads `BUGS_ADMIN_KEY` and
  `BUGS_URL` from the environment or from `.env.local` (gitignored; see `.env.example`).

**Locally:** `npm run bugs:dev` (API on :8787, data in `server/data/`, gitignored) next to
`npm run dev` — Vite proxies `/api` to it. Without it the panel just shows "offline".

### Deploying the bug board (once)

```sh
npm run bugs -- keygen                     # make a key; put it in .env.local as BUGS_ADMIN_KEY=...
ssh root@167.86.92.85 'command -v node && node --version'   # need Node 18+; fix ExecStart if not /usr/bin/node
ssh root@167.86.92.85 'ss -ltn | grep -c :8787'             # must print 0: port is free
rsync -av server/core.mjs server/index.mjs root@167.86.92.85:/opt/cub3d-bugs/
scp deploy/cub3d-bugs.service root@167.86.92.85:/etc/systemd/system/
ssh root@167.86.92.85 'umask 077 && printf "BUGS_ADMIN_KEY=%s\n" "<KEY>" > /etc/cub3d-bugs.env'
ssh root@167.86.92.85 'systemctl daemon-reload && systemctl enable --now cub3d-bugs && curl -s 127.0.0.1:8787/api/health'
# Replace the play.langerock.xyz block in ~/contaboguidel/infra/Caddyfile with deploy/play.caddy
# (it now splits /api/* into its own handle), then run infra/deploy.sh; it validates and reloads.
./deploy/deploy.sh                         # ships the frontend with the new button
curl -s https://play.langerock.xyz/api/health   # {"ok":true,...}
npm run bugs -- list                       # "No reports."
```

The frontend can go out before or after the API: until `/api/*` answers JSON, the panel
shows "offline". Reports live in `/var/lib/cub3d-bugs/bugs.json` — back that file up if
you care about them. Server code updates are the `rsync` line plus
`systemctl restart cub3d-bugs`.

## Credits

The C original is by **Simon Langerock** and **agoldber**. Wall textures and the weapon
flipbook come from that repository.
