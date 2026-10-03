# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on `sowel-recipe-ev-charge-smart`. First file to read. Same method as the Sowel core: spec with gates, feature branch, tests, agent review, PR, explicit merge approval.

## What this is

A Sowel **recipe package**: it drives an **EV charger** (core spec 182, `ev_charger`) for one or more **electric vehicles** (core spec 183, `electric_vehicle`). It charges from the **solar surplus** through the energy arbiter (core spec 140), guarantees a **minimum battery level by a departure time** from the grid, and **wakes a sleeping car** when the charger refuses to start.

Measured on the owner's installation (2026-10-03, dé charger + Renault Rafale): a car whose charge paused sleeps within minutes and the charger then refuses to start ("vehicle not asking for current"); the car's `wake` order makes the start succeed about 20 s later.

## Where to find context

| You want to know...                   | Read this                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| How a recipe package works            | `mchacher/sowel`: `docs/technical/recipe-development.md`, `.claude/skills/sowel-recipe-dev/SKILL.md`                                             |
| The charger and car contracts         | `mchacher/sowel`: `src/shared/ev-charger-contract.ts`, `src/shared/electric-vehicle-contract.ts`, specs 182, 183, 184                            |
| The arbiter (claims, grants, revokes) | `mchacher/sowel`: `specs/140-energy-capacity-arbiter/`, `src/energy/capacity-arbiter.ts`, recipe-development.md "Energy"                         |
| A mature recipe to imitate            | [`sowel-recipe-pool-pump-schedule`](https://github.com/mchacher/sowel-recipe-pool-pump-schedule) (claims, tariff, tile)                          |
| The charger plugin / the car plugin   | [`sowel-plugin-tuya`](https://github.com/mchacher/sowel-plugin-tuya), [`sowel-plugin-renault`](https://github.com/mchacher/sowel-plugin-renault) |
| Every feature specified here          | [docs/specs-index.md](docs/specs-index.md) — one row per spec, CI-gated                                                                          |

The core repo is expected as a sibling directory (`../sowel`).

## Non-negotiable rules

- **Equipments by contract alias, never by vendor key.** The recipe reads and orders the core contract aliases (`state`, `vehicle`, `battery_level`, `wake`…). A missing concept is a core spec, never a workaround here (that is how `refresh` became core spec 184).
- **Honour the arbiter.** Act on `onGranted` / `onRevoked` at once, `reportNeed` on every evaluation, `release()` when the need is gone. Grid charging for the guarantee keeps its claim open (spec 140 hard-quota rule).
- **Never fight the user.** A charger switched by hand is left alone until the car is unplugged.
- **`dispatchOrder` failures come back as `{ success: false }`**, not as a throw: always read the result. A thrown error means the equipment or its integration is unavailable.
- **Never throw** from a timer, an event handler or an arbiter callback. Clear every timer and unsubscribe every handler in `stop()`.
- **Logs**: one recipe-log line per decision change, never one per tick.
- **The decision is pure.** `decide()` takes a snapshot and returns what to do; ctx calls live at the edges. Every rule of the decision table has a unit test.
- **Recipes never import the core.** The types used are mirrored in `src/sowel-types.ts`, kept in sync by hand.
- **Orders to the owner's real charger or car** (candidate tests) only with the owner's agreement.

## Tech

Node 24, TypeScript strict, ESM. Vitest with fake timers. ESLint + Prettier as in the core. `console.*` is an error: log through `ctx.log` / `ctx.logger`.

```bash
npm install
npm run validate        # typecheck, typecheck:tests, lint, format:check, test, build, specs index — what CI runs
npx vitest run <file>   # one test file
```

## Git workflow

- Feature branches for anything non-trivial: `feat/`, `fix/`, `refactor/`, `docs/`. Main is protected (PR required, linear history, CI green).
- Conventional commits. Scopes: `decide`, `charger`, `vehicles`, `arbiter`, `tariff`, `tile`, `manifest`, `ci`.
- **Never merge a PR without explicit user approval** ("oui", "merge", "go").
- **Never add `Co-Authored-By: Claude` lines** in commit messages or PR bodies.
- Every new `specs/NNN-name/` folder needs `spec.md`, `architecture.md`, `plan.md` **and a row in `docs/specs-index.md`**.
- A release is a PR (version bump in `package.json` **and** `manifest.json`, changelog entry), a tag on main, then the **registry hash bump in the core** (spec 089). See the `ev-release` skill.

## Skills

| Skill        | When                                                         |
| ------------ | ------------------------------------------------------------ |
| `ev-feature` | Implementing a feature: spec, branch, tests, PR.             |
| `ev-release` | Bumping, tagging, publishing, and bumping the registry hash. |

## Answering the user

Short and ordered. One or two lines for the what, one bullet per finding or decision. French or English, whichever the user uses.
