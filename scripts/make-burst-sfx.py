"""make-burst-sfx.py — synthesizes assets/sounds/burst_impact.wav (Paint Burst shockwave).
Low pitch-dropping thump + noise whoosh sweeping down + short click transient.
Run: python3 scripts/make-burst-sfx.py  (numpy only). 44.1 kHz mono 16-bit, ~0.9 s."""
import numpy as np, wave
SR = 44100
t = np.arange(int(SR * 0.9)) / SR
rng = np.random.default_rng(7)
# Thump: sine sweeping 120 → 38 Hz, fast attack, ~0.35 s decay, soft-clipped for punch.
f = 38 + 82 * np.exp(-t * 18)
thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5) * np.minimum(1, t / 0.003)
thump = np.tanh(thump * 2.2) * 0.9
# Whoosh: noise through a one-pole low-pass whose cutoff falls 6 kHz → 300 Hz, swell then fade.
noise = rng.standard_normal(len(t))
cut = 300 + 5700 * np.exp(-t * 6)
a = np.exp(-2 * np.pi * cut / SR)
w = np.zeros_like(noise); y = 0.0
for i in range(len(t)):
    y = (1 - a[i]) * noise[i] + a[i] * y
    w[i] = y
whoosh = w / (np.max(np.abs(w)) + 1e-9) * (np.minimum(1, t / 0.02) * np.exp(-t * 4.5)) * 0.45
# Click: 4 ms bright transient for the crack.
click = rng.standard_normal(len(t)) * np.exp(-t * 900) * 0.5
mix = thump + whoosh + click
mix = mix / np.max(np.abs(mix)) * 0.95
fade = np.ones_like(t); n = int(SR * 0.05); fade[-n:] = np.linspace(1, 0, n)
pcm = (mix * fade * 32767).astype(np.int16)
with wave.open('assets/sounds/burst_impact.wav', 'wb') as f_:
    f_.setnchannels(1); f_.setsampwidth(2); f_.setframerate(SR); f_.writeframes(pcm.tobytes())
print('wrote assets/sounds/burst_impact.wav', len(pcm) / SR, 's')
