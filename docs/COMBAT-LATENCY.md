# Combat latency map (Milestone B lag pass) — 2026-10-23

## Pipeline (Lunge E / Burst F)

1. **Press (attacker client)** — local SFX / VFX / self-impulse on the input frame.
2. **Ability start message** — `lungeStart` / `burstUse` → server validates → broadcast `lungeStarted` / `burstFired` (remotes see telegraph).
3. **Hit detect (attacker client)** — swept box (Lunge) or radius (Burst); send `lungeHit` / `burstHit`.
4. **Server authority** — ledger dedupe + team + window → broadcast `lungeImpact` / `burstImpact`.
5. **Victim client** — ImpactGate (dedupe + max age) → local Physics impulse (SDK can only move the local avatar).

Victim knockback therefore always pays **~1 RTT after the attacker's hit detect**. That cannot be removed without speculative victim physics (deferred: risk of contradictory knockback).

## Root causes found (this pass)

| Source | Effect | Fix shipped? |
|--------|--------|--------------|
| Burst LOS raycast before `burstHit` | 0–300 ms delay before hit entered the network (`BURST_LOS_TIMEOUT_S` fail-open) | Yes — `BURST_LOS = false` |
| `burstFired` after paint footprint loop | Remotes / ImpactGate start delayed by paint work | Yes — broadcast first |
| Burst press sent network before local FX | Activate felt one tick late vs Lunge | Yes — `showShockwave` before `sendBurstUse` |
| Burst attacker had no connect SFX on player hits | Unclear attribution on press | Yes — optimistic `playDashHitSfx` + positional pop |
| `LUNGE_IMPACT_MAX_AGE_MS = 400` | High RTT silently dropped real knockbacks (felt like lag) | Yes — 800 ms (Burst 600→900) |
| Victim impulse waits on server round-trip | Inherent to authority model | No — needs 2-client playtest; speculative knock deferred |

## Remaining risks / next playtest

- **2-client:** confirm knockbacks still apply (not dropped) and directions match; watch for rare through-geometry Burst hits with LOS off.
- Victim still feels knock **after** RTT — if still muddy, next lever is cautious local anticipation on `lungeStarted`/`burstFired` + gate (not done here).
- Do not reintroduce mode vote / Corruption.

## How to verify

1. Solo Creator Hub: E/F activate SFX/VFX feel immediate; Burst near a dummy/player should pop on connect without a pause.
2. Ideally two Explorers: Lunge/Burst each other; victim should fly more reliably; attacker should hear connect instantly; remotes should see Burst FX sooner.
