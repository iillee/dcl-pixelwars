# Combat latency map (Milestone B) — updated 2026-10-23

## Pipeline (Lunge E / Burst F)

1. **Press (attacker client)** — local SFX / VFX / self-impulse on the input frame.
2. **Ability start message** — `lungeStart` / `burstUse` → server validates → broadcast `lungeStarted` / `burstFired` (remotes see telegraph).
3. **Hit detect (attacker client)** — swept box (Lunge) or radius (Burst); send `lungeHit` / `burstHit`.
4. **Server authority** — ledger dedupe + team + window → broadcast `lungeImpact` / `burstImpact`.
5. **Victim client** — ImpactGate (dedupe + max age) → local Physics impulse (SDK can only move the local avatar).

## Victim speculative knock (2026-10-23, `VICTIM_SPECULATIVE_KNOCK`)

Goal: reduce **perceived** delay between a successful hit and the victim actually moving.

| Ability | When we anticipate | How |
|---------|-------------------|-----|
| **Lunge** | After `lungeStarted`, each frame while the active+grace window is live | Victim runs the same `boxHit` against the remote lunger's avatar on their screen. On contact → apply full knock + `ImpactGate.accept`. |
| **Burst** | On `burstFired` | If local feet are inside `inBurst(origin)` and opposing team → apply full knock + gate.accept immediately. |

Confirmed `*Impact` still goes through `ImpactGate`: if speculation already applied that `(attacker, id)`, Impact is **dup** (no double push). If speculation never fired (we looked outside the volume), Impact applies normally.

Toggle: `VICTIM_SPECULATIVE_KNOCK` in `shared/pvp.ts`.

### Residual risk
- **False knock / ghost push:** we look in-volume (avatar desync) but the attacker never reports us → server never sends Impact. We still flew. No soft-revert (avoids jank if Impact is merely late). Rare in practice; same geometry as the attacker uses.
- Direction uses the same `knockDir` / `burstDir` formulas as the confirmed path, so confirmed Impact matching speculation should not diverge when both fire.

## Root causes / fixes

| Source | Effect | Fix |
|--------|--------|-----|
| Burst LOS raycast before `burstHit` | 0–300 ms delay | `BURST_LOS = false` |
| `burstFired` after paint loop | Remotes delayed | Broadcast first |
| Burst press sent network before local FX | Activate felt late | `showShockwave` before send |
| Tight Impact max-age | High RTT dropped real knocks | Lunge 800 / Burst 900 ms |
| Victim impulse waits on Impact RTT | Opponent moves late | **Speculative knock (this pass)** |

## How to verify (2 clients)

1. Two Explorers on opposite teams, restart Creator Hub after pull.
2. **Lunge:** A charges B. B should start flying when A's body reaches them on B's screen — not a full beat later. A should see B move sooner than before. Console on B: `[Lunge] speculative knock by …` often, then Impact arrives as dup (no second shove).
3. **Burst:** A fires F next to B. B should move on/near the shockwave, not after an extra hitch. Console: `[Burst] speculative knock by …`.
4. Watch for rare false knocks (B flies with no attacker hit FX) — note and we can tighten or disable the flag.
5. Confirm no double-launch (speculation + Impact).
