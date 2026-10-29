# Micro Mayhem

A top-down, pseudo-3D toy-car combat racer. Six cars, three laps, pickup weapons, damage and destruction. One HTML file, no build step, no assets.

**Play:** https://jiri-studioprobe.github.io/micro-mayhem/

## Controls

- Arrow keys / WASD: steer and accelerate
- Space / F / Shift: fire
- M: mute
- Touch: on-screen pad appears on first touch

## Run locally

```bash
python3 -m http.server
```

Then open http://localhost:8000. Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`.

Project notes, architecture and tuning values are in [CLAUDE.md](CLAUDE.md).
