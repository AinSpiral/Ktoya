import json, math, random, subprocess, wave
from pathlib import Path
import numpy as np

voice = Path('tmp_tts_fairy/voice.mp3')
out = Path('tmp_tts_fairy/ambience.wav')

def duration(path):
    p = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)],capture_output=True,text=True,check=True)
    return float(p.stdout.strip())

D = duration(voice)
sr = 44100
n = int(D*sr)
rng = np.random.default_rng(9121986)

# Gentle meadow air: filtered noise, intentionally subtle.
noise = rng.normal(0, 1, n).astype(np.float32)
# smooth with short moving average + slower envelope
kernel = np.ones(900, dtype=np.float32)/900
breeze = np.convolve(noise, kernel, mode='same')
breeze /= max(np.max(np.abs(breeze)), 1e-6)

t = np.arange(n, dtype=np.float32)/sr
env = 0.55 + 0.20*np.sin(2*np.pi*t/19.0) + 0.10*np.sin(2*np.pi*t/7.7)
amb = 0.035*breeze*env

# Tiny insect shimmer: soft high-frequency, far in the background.
shimmer = 0.0025*np.sin(2*np.pi*(5200 + 180*np.sin(2*np.pi*t/11))*t)
amb += shimmer.astype(np.float32)

# Sparse, gentle birds. Chirps avoid speech-band dominance by staying quiet.
def add_chirp(start_s, dur_s, f0, f1, amp):
    i0 = int(start_s*sr); m = int(dur_s*sr)
    if i0 < 0 or i0+m > n: return
    x = np.arange(m, dtype=np.float32)/sr
    k = (f1-f0)/dur_s
    phase = 2*np.pi*(f0*x + 0.5*k*x*x)
    e = np.sin(np.pi*np.clip(x/dur_s,0,1))**2
    amb[i0:i0+m] += (amp*np.sin(phase)*e).astype(np.float32)

random.seed(1986)
cur = 7.0
while cur < D-7:
    cur += random.uniform(10, 21)
    for j in range(random.choice([1,1,2])):
        add_chirp(cur + j*0.32, random.uniform(0.18,0.38), random.uniform(2100,2800), random.uniform(3200,4300), random.uniform(0.010,0.018))

# Slightly richer opening/ending, quieter under narration.
gain = np.full(n, 0.58, dtype=np.float32)
for sec, val in [(0,0.90),(2,0.72),(4,0.58)]:
    idx = min(n, int(sec*sr))
    if sec == 0: gain[:idx] = val
# intro crossfade 0..4 sec
intro = min(n, int(4*sr))
if intro:
    gain[:intro] = np.linspace(0.88,0.58,intro,dtype=np.float32)
outro = min(n, int(5*sr))
if outro:
    gain[-outro:] = np.linspace(0.58,0.88,outro,dtype=np.float32)
amb *= gain
amb = np.clip(amb, -0.20, 0.20)

pcm = (amb*32767).astype(np.int16)
with wave.open(str(out),'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())

Path('tmp_tts_fairy/ambience_meta.json').write_text(json.dumps({'duration':D,'sample_rate':sr},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Generated ambience {D:.2f}s')
