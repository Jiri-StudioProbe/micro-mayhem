# Micro Mayhem

A top-down, pseudo-3D toy-car combat racer. Six cars, three laps, pickup weapons, damage and destruction. Plain HTML and ES modules, no build step, no image assets, no third-party requests.

**Play:** https://jiri-studioprobe.github.io/micro-mayhem/

## Controls

- Arrow keys / WASD: steer and accelerate
- Space / F / Shift: fire
- M: mute
- Touch: on-screen pad appears on first touch

## Run locally

```bash
npm run serve
```

Then open http://localhost:8000 (opening `index.html` straight from disk does not work: browsers refuse ES modules over `file://`). The start screen shows the version and the commit that is deployed. Every push runs the tests (`npm test`); a push to `main` that passes them is deployed to GitHub Pages and checked against the live site, via `.github/workflows/pages.yml`.

Project notes, architecture and tuning values are in [CLAUDE.md](CLAUDE.md).
