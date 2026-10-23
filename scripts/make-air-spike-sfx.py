"""make-air-spike-sfx.py — three distinct Aerial Burst cues.

air_spike_dive.wav  — hard descending whoosh + short thump (the press).
air_spike_hit.wav   — bright crack, almost no sub (player connect).
air_spike_stamp.wav — low floor thud, no whoosh (cross paint only).

Run: python3 scripts/make-air-spike-sfx.py  (numpy). 44.1 kHz mono 16-bit.
"""
import numpy as np
import wave

SR = 44100


def write(name: str, mix: np.ndarray) -> None:
    peak = np.max(np.abs(mix)) + 1e-9
    pcm = (np.clip(mix / peak, -1, 1) * 0.95 * 32767).astype(np.int16)
    with wave.open(name, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print('wrote', name, len(pcm) / SR, 's')


def dive() -> None:
    n = int(SR * 0.42)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    noise = rng.standard_normal(n)
    cut = 280 + 7400 * np.exp(-t * 14)
    a = np.exp(-2 * np.pi * cut / SR)
    w = np.zeros(n)
    y = 0.0
    for i in range(n):
        y = (1 - a[i]) * noise[i] + a[i] * y
        w[i] = y
    env = np.minimum(1, t / 0.012) * np.exp(-t * 6.5)
    whoosh = w / (np.max(np.abs(w)) + 1e-9) * env * 0.85
    f = 90 + 70 * np.exp(-t * 30)
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16) * np.minimum(1, t / 0.002)
    write('assets/sounds/air_spike_dive.wav', whoosh + np.tanh(thump * 2.4) * 0.55)


def hit() -> None:
    n = int(SR * 0.16)
    t = np.arange(n) / SR
    rng = np.random.default_rng(11)
    crack = rng.standard_normal(n) * np.exp(-t * 70) * np.minimum(1, t / 0.001)
    tick = np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 80) * 0.45
    body = np.sin(2 * np.pi * 420 * t) * np.exp(-t * 40) * 0.25
    write('assets/sounds/air_spike_hit.wav', crack * 0.7 + tick + body)


def stamp() -> None:
    n = int(SR * 0.32)
    t = np.arange(n) / SR
    f = 48 + 40 * np.exp(-t * 22)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * np.minimum(1, t / 0.003)
    write('assets/sounds/air_spike_stamp.wav', np.tanh(body * 2.8))


if __name__ == '__main__':
    dive()
    hit()
    stamp()
