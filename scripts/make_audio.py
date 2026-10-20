#!/usr/bin/env python3
"""Procedural cinematic score (numpy only) + optional narration mix with ducking.
usage: make_audio.py --mode main|shorts --out audio.wav [--narration narration_main.json]
"""
import argparse, json, subprocess, wave
import numpy as np

SR = 44100
ap = argparse.ArgumentParser()
ap.add_argument('--mode', default='main'); ap.add_argument('--out', required=True); ap.add_argument('--narration')
ap.add_argument('--music-gain', type=float, default=1.0)
a = ap.parse_args()
TL = json.load(open('data/timeline.json'))
DUR = TL[a.mode]['duration']
N = int(DUR * SR)
rng = np.random.default_rng(42)
t = np.arange(N) / SR

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def env_at(keys):  # piecewise-linear intensity curve
    xs, ys = zip(*keys); return np.interp(t, xs, ys)

if a.mode == 'main':
    inten = env_at([(0, .55), (28, .55), (30, .3), (62, .3), (64, .5), (100, .6), (118, .75), (124, 1.0), (140, .8), (155, .6), (156, .7), (215, .7), (216, .45),
                    (258, .45), (260, .5), (312, .55), (314, .75), (372, .7), (374, .35), (425, .35), (427, .6), (462, .55), (470, .3), (480, .15)])
    boom_times = [0.0, 62.0, 100.0, 124.0, 258.0, 312.0, 372.0, 462.0]
    boom_gain = [.7, .4, .5, 1.0, .35, .5, .35, .5]
else:
    inten = env_at([(0, .7), (9, .7), (14, .9), (15, 1.0), (21, .8), (33, .75), (46, .5), (58, .2)])
    boom_times = [0.0, 15.0]; boom_gain = [.7, 1.0]

# ---- chord pads: Am - F - C - G (+ E for tension)
prog = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
BLK = 12.0
pad = np.zeros(N)
nblk = int(np.ceil(DUR / BLK)) + 1
for b in range(nblk):
    s0 = b * BLK - 2.0; s1 = (b + 1) * BLK + 2.0
    i0 = max(0, int(s0 * SR)); i1 = min(N, int(s1 * SR))
    if i1 <= i0: continue
    tt = t[i0:i1]; w = np.sin(np.pi * np.clip((tt - s0) / (s1 - s0), 0, 1)) ** 2
    chord = prog[b % 4]
    sig = np.zeros(len(tt))
    for k, m in enumerate(chord):
        for det in (-0.12, 0.0, 0.12):
            f = midi(m) * 2 ** (det / 12)
            ph = 2 * np.pi * f * tt + rng.uniform(0, 6.28)
            sig += (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)) * (0.55 + 0.45 * np.sin(0.2 * tt + k))
    pad[i0:i1] += sig * w / 12.0
pad *= (0.35 + 0.65 * inten)

# ---- sub drone
sub = np.sin(2 * np.pi * 55 * t) * 0.5 + np.sin(2 * np.pi * 110 * t) * 0.15
sub *= (0.12 + 0.2 * inten) * (0.8 + 0.2 * np.sin(0.35 * t))

# ---- arpeggio + pulse
arp = np.zeros(N); step = 60 / 108 / 2
pat = [0, 2, 1, 3, 2, 1, 3, 2]
n_steps = int(DUR / step)
for i in range(n_steps):
    ts = i * step; ig = inten[min(N - 1, int(ts * SR))]
    if ig < 0.52: continue
    chord = prog[int(ts // BLK) % 4]; m = chord[pat[i % 8]] + 12
    i0 = int(ts * SR); L = int(0.55 * SR); i1 = min(N, i0 + L)
    if i1 <= i0: continue
    tt = np.arange(i1 - i0) / SR; f = midi(m)
    arp[i0:i1] += (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 6.5) * (ig - 0.4) * 0.16
kick = np.zeros(N)
for ts in np.arange(0, DUR, 60 / 54):
    ig = inten[min(N - 1, int(ts * SR))]
    if ig < 0.68: continue
    i0 = int(ts * SR); i1 = min(N, i0 + int(0.5 * SR)); tt = np.arange(i1 - i0) / SR
    kick[i0:i1] += np.sin(2 * np.pi * (48 + 60 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 8) * (ig - 0.55) * 0.5

# ---- Mars wind (shaped noise)
wn = rng.standard_normal(N); F = np.fft.rfft(wn); fr = np.fft.rfftfreq(N, 1 / SR); fr[0] = 1
wind = np.fft.irfft(F / fr ** 0.9 * (fr < 900), N); wind /= np.abs(wind).max()
wind *= 0.1 * (0.6 + 0.4 * np.sin(0.13 * t + 1.0) ** 2)

# ---- impacts + risers
fx = np.zeros(N)
for bt, bg in zip(boom_times, boom_gain):
    i0 = int(bt * SR)
    L = min(N - i0, int(4.0 * SR))
    if L > 0:
        tt = np.arange(L) / SR
        fx[i0:i0 + L] += (np.sin(2 * np.pi * (40 + 50 * np.exp(-tt * 5)) * tt) * np.exp(-tt * 1.3) + rng.standard_normal(L) * np.exp(-tt * 9) * 0.3) * bg * 0.9
    r0 = max(0, int((bt - 3.0) * SR)); r1 = min(N, int(bt * SR))
    if r1 > r0:
        L2 = r1 - r0; x = np.linspace(0, 1, L2)
        ns = rng.standard_normal(L2) * (x ** 2.2) * 0.18 * bg
        k = max(3, int(60 - 55 * x.mean())); ns = np.convolve(ns, np.ones(k) / k, 'same')
        fx[r0:r1] += ns

music = pad + sub + arp + kick + wind + fx

# ---- stereo reverb (block FFT convolution)
def ir(seed, sec=2.8):
    g = np.random.default_rng(seed); L = int(sec * SR); x = np.arange(L) / SR
    return g.standard_normal(L) * np.exp(-x * 2.1) * (1 - np.exp(-x * 60))
irs = [ir(1), ir(2)]; BL = 1 << 19; FFTN = 1 << 21
wet = [np.zeros(N + len(irs[0]) + BL) for _ in range(2)]
IRF = [np.fft.rfft(i, FFTN) for i in irs]
for s in range(0, N, BL):
    blk = music[s:s + BL]
    B = np.fft.rfft(blk, FFTN)
    for c in range(2):
        out = np.fft.irfft(B * IRF[c], FFTN)[:len(blk) + len(irs[c]) - 1]
        wet[c][s:s + len(out)] += out
wet = [w[:N] for w in wet]
wmax = max(np.abs(wet[0]).max(), np.abs(wet[1]).max(), 1e-9); wet = [w / wmax * np.abs(music).max() for w in wet]
L = music * 0.75 + wet[0] * 0.32; R = music * 0.75 + wet[1] * 0.32
L *= a.music_gain; R *= a.music_gain

# ---- narration with ducking
voice = np.zeros(N)
if a.narration:
    man = json.load(open(a.narration))
    for it in man['items']:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', it['file'], '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True).stdout
        v = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
        i0 = int((it['t0'] + 0.1) * SR)
        if i0 >= N: continue
        v = v[:N - i0]; voice[i0:i0 + len(v)] += v
    if np.abs(voice).max() > 0:
        voice /= np.abs(voice).max(); voice *= 0.9
        k = int(0.25 * SR); level = np.convolve(np.abs(voice), np.ones(k) / k, 'same')
        duck = 1.0 - 0.68 * np.clip(level / 0.04, 0, 1)
        k2 = int(0.35 * SR); duck = np.convolve(duck, np.ones(k2) / k2, 'same')
        L *= duck; R *= duck

peak = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
scale = (0.5 if voice.any() else 0.8) / peak
L *= scale; R *= scale
mixL = L + voice; mixR = R + voice
# fade in/out
fi = np.clip(t / 1.5, 0, 1); fo = np.clip((DUR - t) / 2.5, 0, 1); g = fi * fo
st = np.stack([mixL * g, mixR * g], 1)
st = np.clip(st, -0.99, 0.99)
pcm = (st * 32767).astype('<i2')
with wave.open(a.out, 'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes(pcm.tobytes())
print('wrote', a.out, f'{DUR}s', 'with narration' if voice.any() else 'music only')
