import asyncio, json, subprocess, wave
from pathlib import Path
import numpy as np
import edge_tts

ROOT = Path(__file__).parent
SEGMENTS = json.loads((ROOT / 'story_segments.json').read_text(encoding='utf-8'))
SR = 44100

VOICE_CFG = {
    'narrator': ('ru-RU-DariyaNeural', '-3%', '-1Hz'),
    'butterfly': ('ru-RU-SvetlanaNeural', '+3%', '+8Hz'),
    'dragonfly': ('ru-RU-DariyaNeural', '-6%', '-6Hz'),
    'burdock': ('ru-RU-DmitryNeural', '-7%', '-9Hz'),
}
FALLBACK = {
    'narrator': ('ru-RU-SvetlanaNeural', '-3%', '-1Hz'),
    'butterfly': ('ru-RU-SvetlanaNeural', '+3%', '+8Hz'),
    'dragonfly': ('ru-RU-SvetlanaNeural', '-6%', '-6Hz'),
    'burdock': ('ru-RU-DmitryNeural', '-7%', '-9Hz'),
}

async def synth_one(i, seg):
    voice, rate, pitch = VOICE_CFG[seg['role']]
    mp3 = ROOT / f'raw_{i:03d}.mp3'
    try:
        await edge_tts.Communicate(seg['text'], voice=voice, rate=rate, pitch=pitch).save(str(mp3))
    except Exception:
        voice, rate, pitch = FALLBACK[seg['role']]
        await edge_tts.Communicate(seg['text'], voice=voice, rate=rate, pitch=pitch).save(str(mp3))
    wav = ROOT / f'raw_{i:03d}.wav'
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(mp3),'-ar',str(SR),'-ac','1','-c:a','pcm_s16le',str(wav)], check=True)
    return voice

async def synth_all():
    used=[]
    for i, seg in enumerate(SEGMENTS):
        used.append(await synth_one(i, seg))
    return used

used_voices = asyncio.run(synth_all())

def read_wav(path):
    with wave.open(str(path),'rb') as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    return sr, x

def write_wav(path, x, sr=SR):
    x = np.clip(x, -1, 1)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((x*32767).astype('<i2').tobytes())

def trim_only_outer_digital_silence(x, sr=SR, threshold_db=-65.0, keep_head=0.055, keep_tail=0.280):
    # Important: only trim the outer almost-digital silence that Edge TTS adds.
    # Never touch pauses inside an utterance; this preserves the natural cadence.
    threshold = 10 ** (threshold_db / 20.0)
    idx = np.flatnonzero(np.abs(x) > threshold)
    if len(idx) == 0:
        return x
    a = max(0, int(idx[0] - keep_head*sr))
    b = min(len(x), int(idx[-1] + keep_tail*sr))
    y = x[a:b].copy()
    # Micro-fades only at file edges, outside the actual spoken phonemes, to prevent hard edit clicks.
    f = min(int(0.012*sr), len(y)//8)
    if f > 2:
        ramp = np.sin(np.linspace(0, np.pi/2, f))**2
        y[:f] *= ramp
        y[-f:] *= ramp[::-1]
    return y

pieces=[]
segment_durations=[]
for i, seg in enumerate(SEGMENTS):
    sr, x = read_wav(ROOT / f'raw_{i:03d}.wav')
    assert sr == SR
    y = trim_only_outer_digital_silence(x)
    pieces.append(y)
    segment_durations.append(round(len(y)/SR,3))
    gap = float(seg.get('gap',0.0))
    if gap:
        pieces.append(np.zeros(int(gap*SR), dtype=np.float32))

# A brief natural scene lead-in/lead-out. The ambience plays through these; the listener never hears dead air.
voice = np.concatenate([np.zeros(int(0.42*SR),dtype=np.float32), *pieces, np.zeros(int(0.62*SR),dtype=np.float32)])
write_wav(ROOT/'voice_full.wav', voice)
DUR = len(voice)/SR

# Build a genuinely audible background from real CC0 field recordings.
birds = ROOT/'birds.ogg'
stream = ROOT/'stream.ogg'
bg = ROOT/'background.wav'
fade_out_start = max(0, DUR-0.8)
filter_bg = (
    f"[0:a]highpass=f=120,lowpass=f=10500,loudnorm=I=-28:TP=-5:LRA=12[b];"
    f"[1:a]highpass=f=80,lowpass=f=7000,loudnorm=I=-34:TP=-7:LRA=10[s];"
    f"[b][s]amix=inputs=2:weights='1 0.55':normalize=0,loudnorm=I=-26:TP=-4:LRA=12,"
    f"afade=t=in:st=0:d=0.45,afade=t=out:st={fade_out_start:.3f}:d=0.75[bg]"
)
subprocess.run([
    'ffmpeg','-loglevel','error','-y','-stream_loop','-1','-i',str(birds),'-stream_loop','-1','-i',str(stream),
    '-filter_complex',filter_bg,'-map','[bg]','-t',f'{DUR:.3f}','-ar',str(SR),'-ac','2','-c:a','pcm_s16le',str(bg)
], check=True)

# Voice stays clear, but the meadow remains audible. Background is ducked gently, not buried.
final = ROOT/'Сказка_о_Бабочке_ЖИВАЯ_плавная_v3.mp3'
filter_mix = (
    "[0:a]loudnorm=I=-16:TP=-1.5:LRA=8,pan=stereo|c0=c0|c1=c0,asplit=2[vsc][v];"
    "[1:a]volume=1.0[bg];"
    "[bg][vsc]sidechaincompress=threshold=0.018:ratio=3.2:attack=22:release=480:makeup=1[duck];"
    "[v][duck]amix=inputs=2:duration=first:weights='1 1':normalize=0,alimiter=limit=0.96[out]"
)
subprocess.run([
    'ffmpeg','-loglevel','error','-y','-i',str(ROOT/'voice_full.wav'),'-i',str(bg),
    '-filter_complex',filter_mix,'-map','[out]','-ar',str(SR),'-ac','2','-c:a','libmp3lame','-b:a','192k',str(final)
], check=True)

(ROOT/'source_spoken.txt').write_text(' '.join(s['text'] for s in SEGMENTS),encoding='utf-8')
report = {
    'segment_count': len(SEGMENTS),
    'duration_seconds': round(DUR,3),
    'max_added_gap_seconds': max(float(s.get('gap',0)) for s in SEGMENTS),
    'kept_natural_tts_tail_seconds': 0.280,
    'segment_durations_seconds': segment_durations,
    'voices_used': used_voices,
    'background_target_lufs_before_ducking': -26,
    'background_sources': [
        'https://upload.wikimedia.org/wikipedia/commons/2/2f/Birds_chirping_in_a_garden.ogg',
        'https://upload.wikimedia.org/wikipedia/commons/8/84/Swale.ogg'
    ]
}
(ROOT/'render_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
