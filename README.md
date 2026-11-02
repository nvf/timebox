# Timebox

[![CI](https://github.com/nvf/timebox/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nvf/timebox/actions/workflows/ci.yml)

A minimal countdown timer for exams, exercises, and meetings.

- Shows whole minutes only (e.g., `47 min`, `1h 25m`) until the last *X* minutes, then switches to `m:ss`
- Optionally counts overtime (e.g., `+2:13`)
- Duration as `90`, `1:30` or `1h 30m`, or run *until* a clock time
- Progress bar; end time at the bottom of the page
- High-contrast themes (light, dark, sage) that hold up on projectors

**Live:** https://nvf.github.io/timebox/

## Controls

| Key | Action |
| --- | --- |
| `Space` / `P` | Pause / resume |
| `B` | Add 1 minute of buffer |
| `Shift`+`B` | Remove 1 minute |
| `Cmd`/`Ctrl` `+` / `−` / `0` | Make the timer larger / smaller / reset size (pinch gesture also works) |
| `L` | Layout tool: move the timer up/down and resize it |
| `Shift`+`↑` / `↓` | Move the timer up / down a small step (works any time) |
| `O` | Overtime on / off: keep counting past zero (also a checkbox before starting) |
| `F` | Fullscreen |
| `T` | Cycle theme: light → dark → sage |
| `R` | Stop & reset (press twice) |
| `?` | Show / hide this list on screen |
| Long-press clock | Add 1 minute (touch screens) |
| Double-click preset | Start right away |

### Layout tool

E.g., for long rooms and low projectors. Press `L` (or click ↕):

- `↑` / `↓` move the timer step-wise, `+` / `−` resize it
- **Reset** recenters it, **Done** / `Esc` closes the tool

## Preset links

Prefill the setup form via URL (or use **Copy link**):

```
?m=90&s=10&t=Workshop
?u=14:30&t=Exam
```

- `m`: duration (`90`, `1:30`, `1h30`)
- `u`: run until this clock time (instead of `m`)
- `s`: show seconds in the last *s* minutes
- `t`: title
- `o=1`: counts overtime

## Development

```sh
npm install     # dev tools only
npm start       # http://localhost:8080 (ES modules need HTTP, not file://)
npm run check   # lint + tests
```

```
src/    the website (deployed as-is)
test/   unit tests
```

CI lints, tests, and deploys `src/` to GitHub Pages (every push to `main`).
