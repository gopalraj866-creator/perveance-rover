#!/usr/bin/env python3
"""Synthesize narration for every caption that has a `say` line using Microsoft Edge neural voices (pip install edge-tts).
Needs internet access (fine on GitHub Actions). If it fails the video simply ships with music only.
usage: narrate.py --mode main|shorts --out dir [--voice en-IN-PrabhatNeural]
"""
import argparse, json, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument('--mode', default='main'); ap.add_argument('--out', required=True)
ap.add_argument('--voice', default=os.environ.get('VOICE', 'en-IN-PrabhatNeural'))
ap.add_argument('--rate', default='-2%')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
caps = json.load(open('data/timeline.json'))[a.mode]['captions']

def dur(f):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)

items = []
for i, c in enumerate(caps):
    if not c.get('say'): continue
    raw = os.path.join(a.out, f'{a.mode}_{i:02d}_raw.mp3'); fin = os.path.join(a.out, f'{a.mode}_{i:02d}.mp3')
    cmd = [sys.executable, '-m', 'edge_tts', '--voice', a.voice, f'--rate={a.rate}', '--text', c['say'], '--write-media', raw]
    ok = False
    for attempt in range(3):
        if subprocess.run(cmd, capture_output=True).returncode == 0 and os.path.exists(raw) and dur(raw) > 0.3: ok = True; break
    if not ok: print('TTS failed for caption', i); continue
    d = dur(raw); window = c['t1'] - c['t0'] + 0.8
    if d > window:
        tempo = min(1.3, d / window)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-filter:a', f'atempo={tempo:.3f}', fin], check=True); d /= tempo
    else:
        os.replace(raw, fin)
    items.append({'t0': c['t0'], 'file': fin, 'dur': d}); print(f'caption {i}: {d:.1f}s in window {c["t1"] - c["t0"]:.1f}s')
json.dump({'mode': a.mode, 'items': items}, open(os.path.join(a.out, f'narration_{a.mode}.json'), 'w'), indent=1)
print('narration clips:', len(items), '/', len(caps))
