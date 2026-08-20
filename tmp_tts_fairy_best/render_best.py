import asyncio, json, subprocess, wave
from pathlib import Path
import numpy as np
import edge_tts

root = Path(__file__).parent
segs = json.loads((root / 'story_segments.json').read_text(encoding='utf-8'))
cfg = {
    'narrator': ('ru-RU-SvetlanaNeural', '-3%', '-2Hz'),
    'butterfly': ('ru-RU-SvetlanaNeural', '+5%', '+14Hz'),
    'dragonfly': ('ru-RU-SvetlanaNeural', '-7%', '-8Hz'),
    'burdock': ('ru-RU-DmitryNeural', '-8%', '-12Hz'),
}

async def synthesize():
    for i, s in enumerate(segs):
        voice, rate, pitch = cfg[s['role']]
        mp3 = root / f'seg_{i:03d}.mp3'
        wav = root / f'seg_{i:03d}.wav'
        await edge_tts.Communicate(s['text'], voice=voice, rate=rate, pitch=pitch).save(str(mp3))
        # Trim only leading/trailing TTS silence; preserve pauses inside each sentence.
        af = "silenceremove=start_periods=1:start_silence=0.04:start_threshold=-43dB,areverse,silenceremove=start_periods=1:start_silence=0.04:start_threshold=-43dB,areverse"
        subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(mp3),'-af',af,'-ar','44100','-ac','1','-c:a','pcm_s16le',str(wav)], check=True)

asyncio.run(synthesize())

parts = []
for i, s in enumerate(segs):
    if i == 0:
        pause = 0.48
    elif s['text'].endswith('...'):
        pause = 0.38
    elif s['role'] == 'narrator':
        pause = 0.28
    elif len(s['text']) < 18:
        pause = 0.18
    else:
        pause = 0.23
    sil = root / f'sil_{i:03d}.wav'
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t',str(pause),str(sil)], check=True)
    parts += [root / f'seg_{i:03d}.wav', sil]

(root / 'concat.txt').write_text('\n'.join(f"file '{p.name}'" for p in parts), encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c:a','pcm_s16le','voice.wav'], check=True, cwd=root)

# Brief atmosphere before/after, both under one second.
for name, dur in [('head.wav', 0.55), ('tail.wav', 0.70)]:
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t',str(dur),str(root / name)], check=True)
(root / 'voice_concat.txt').write_text("file 'head.wav'\nfile 'voice.wav'\nfile 'tail.wav'\n", encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','voice_concat.txt','-c:a','pcm_s16le','voice_full.wav'], check=True, cwd=root)

voice_path = root / 'voice_full.wav'
dur = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(voice_path)], text=True))
sr = 44100
n = int(dur * sr)
rng = np.random.default_rng(20260821)
t = np.arange(n) / sr

# Layered meadow: low breeze, soft stream, insect shimmer.
breeze = np.convolve(rng.normal(0, 1, n), np.ones(1600)/1600, mode='same') * 0.15
water = np.convolve(rng.normal(0, 1, n), np.ones(26)/26, mode='same') * 0.040
insects = (np.sin(2*np.pi*6100*t + 0.7*np.sin(2*np.pi*0.17*t)) + 0.35*np.sin(2*np.pi*7700*t)) * 0.0019
amb = breeze + water + insects

# Sparse gentle bird calls; never during every sentence.
for sec in [4.5, 18.0, 36.0, 58.0, 83.0, 110.0, 139.0, 166.0]:
    if sec + 0.5 >= dur:
        continue
    L = int(0.42 * sr)
    x = np.arange(L) / sr
    f = 1880 + 280*np.sin(2*np.pi*x/0.42)
    phase = 2*np.pi*np.cumsum(f)/sr
    a = int(sec * sr)
    amb[a:a+L] += np.sin(phase) * np.hanning(L) * 0.025

# Very subtle warm shimmer near the moral.
start = max(0, dur - 21)
a = int(start * sr)
L = min(int(5.5 * sr), n-a)
x = np.arange(L) / sr
amb[a:a+L] += (np.sin(2*np.pi*880*x) + 0.4*np.sin(2*np.pi*1320*x)) * np.exp(-x/3.7) * 0.0035

with wave.open(str(root / 'ambience.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(np.tanh(amb), -1, 1) * 32767).astype('<i2').tobytes())

# Side-chain ducking: ambience comes forward slightly only between phrases.
filt = ('[0:a]loudnorm=I=-16:TP=-1.5:LRA=8,asplit=2[v1][v2];'
        '[1:a]highpass=f=90,lowpass=f=10500,volume=0.30[bg];'
        '[bg][v1]sidechaincompress=threshold=0.018:ratio=10:attack=16:release=380[duck];'
        '[v2][duck]amix=inputs=2:duration=first:weights=1 0.28:normalize=0,alimiter=limit=0.95[out]')
subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(voice_path),'-i',str(root/'ambience.wav'),'-filter_complex',filt,'-map','[out]','-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','160k',str(root/'Сказка_о_Бабочке_ЖИВАЯ_версия.mp3')], check=True)

(root / 'source_spoken.txt').write_text(' '.join(s['text'] for s in segs), encoding='utf-8')
