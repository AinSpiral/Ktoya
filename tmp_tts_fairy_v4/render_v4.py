import asyncio, json, math, subprocess, wave
from pathlib import Path
import numpy as np
import edge_tts

ROOT = Path(__file__).parent
ROOT.mkdir(exist_ok=True)

# Long semantic blocks: narrator is no longer split sentence-by-sentence.
UTTERANCES = [
    {
        'role':'narrator',
        'text':'Сказка о Бабочке, которая перестала искать колючки. Жила-была маленькая Бабочка. Она очень любила цветы. Но все вокруг учили её совсем другому.'
    },
    {'role':'burdock','text':'Если хочешь стать сильной, сначала полетай над колючками.'},
    {'role':'butterfly','text':'Почему?'},
    {'role':'burdock','text':'Потому что настоящий путь всегда трудный.'},
    {
        'role':'narrator',
        'text':'Тогда Бабочка летела к колючкам. Цеплялась за них крылышками. Уставала. Грустила. Но почему-то счастливее не становилась. Однажды она встретила старую Стрекозу. Та легко кружилась над цветущим лугом и весело смеялась.'
    },
    {'role':'butterfly','text':'Почему ты такая счастливая?'},
    {'role':'dragonfly','text':'Потому что лечу туда, где мне хорошо.'},
    {'role':'butterfly','text':'Разве не нужно сначала пострадать?'},
    {'role':'narrator','text':'Стрекоза очень удивилась.'},
    {'role':'dragonfly','text':'А кто тебе это сказал?'},
    {'role':'butterfly','text':'Все говорят...'},
    {'role':'narrator','text':'Стрекоза присела рядом.'},
    {
        'role':'dragonfly',
        'text':'Посмотри на пчёл. Они летят к цветам. Посмотри на птиц. Они летят туда, где тёплое солнце. Посмотри на ручей. Он течёт туда, где ему легко. Никто в природе специально не ищет место, где хуже.'
    },
    {'role':'narrator','text':'Бабочка задумалась.'},
    {'role':'butterfly','text':'Но если я буду лететь только к цветам... разве я не стану ленивой?'},
    {'role':'narrator','text':'Стрекоза рассмеялась.'},
    {'role':'dragonfly','text':'Попробуй!'},
    {
        'role':'narrator',
        'text':'На следующее утро Бабочка решила провести необычный день. Она летела только туда, куда радостно отзывалось её сердце. На ромашки. Потом на василёк. Потом к ароматной лаванде. Она познакомилась с Пчёлкой. Помогла Божьей Коровке найти дорогу домой. Напоила Росинку солнечным светом. Поиграла с Ветерком. И вдруг заметила, что совсем не сидела без дела. Наоборот. Она сделала столько добрых дел, сколько раньше не успевала за целую неделю.'
    },
    {'role':'narrator','text':'Вечером Стрекоза спросила:'},
    {'role':'dragonfly','text':'Ну что, ты весь день только отдыхала?'},
    {'role':'narrator','text':'Бабочка улыбнулась.'},
    {
        'role':'butterfly',
        'text':'Нет. Я просто всё время делала то, к чему меня звало сердце. И оказалось, что именно там меня уже ждали.'
    },
    {
        'role':'narrator_final',
        'text':'С тех пор Бабочка перестала искать колючки специально. Если на пути они встречались, она аккуратно их облетала. А своё внимание снова направляла к цветам. И жители луга запомнили один важный секрет. Источник жизни похож на солнышко. Он светит не там, где больше страдают. Он светит там, где сердце раскрывается. И чем чаще ты идёшь за добрым внутренним зовом, тем больше света появляется и в тебе, и вокруг тебя.'
    },
]

async def choose_voices():
    voices = await edge_tts.list_voices()
    names = {v['ShortName'] for v in voices}
    narrator = 'en-US-AndrewMultilingualNeural' if 'en-US-AndrewMultilingualNeural' in names else 'ru-RU-DmitryNeural'
    butterfly = 'ru-RU-SvetlanaNeural'
    dragonfly = 'ru-RU-SvetlanaNeural'
    burdock = 'ru-RU-DmitryNeural'
    return {
        'narrator': (narrator, '-2%', '-2Hz'),
        'narrator_final': (narrator, '-5%', '-4Hz'),
        'butterfly': (butterfly, '+3%', '+9Hz'),
        'dragonfly': (dragonfly, '-5%', '-7Hz'),
        'burdock': (burdock, '-7%', '-10Hz'),
    }

def decode_and_keep_natural_tail(mp3: Path, wav_out: Path, threshold_db=-72.0):
    tmp = wav_out.with_suffix('.raw.wav')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(mp3),'-ar','44100','-ac','1','-c:a','pcm_s16le',str(tmp)],check=True)
    with wave.open(str(tmp),'rb') as w:
        sr=w.getframerate(); data=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float64)/32768.0
    thr=10**(threshold_db/20)
    idx=np.flatnonzero(np.abs(data)>thr)
    if len(idx)==0:
        trimmed=data
    else:
        start=max(0,int(idx[0]-0.055*sr))
        # Preserve the real vocal decay, plus a small natural room tail.
        end=min(len(data),int(idx[-1]+0.42*sr))
        trimmed=data[start:end]
    # 8 ms boundary fade only prevents clicks; it is not an audible phrase fade.
    f=min(int(0.008*sr),len(trimmed)//2)
    if f>0:
        trimmed[:f]*=np.linspace(0,1,f,endpoint=False)
        trimmed[-f:]*=np.linspace(1,0,f,endpoint=False)
    with wave.open(str(wav_out),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr)
        w.writeframes((np.clip(trimmed,-1,1)*32767).astype('<i2').tobytes())
    tmp.unlink(missing_ok=True)

async def synthesize():
    cfg=await choose_voices()
    used=[]
    for i,u in enumerate(UTTERANCES):
        voice,rate,pitch=cfg[u['role']]
        used.append({'role':u['role'],'voice':voice,'rate':rate,'pitch':pitch,'chars':len(u['text'])})
        mp3=ROOT/f'u_{i:02d}.mp3'
        wav=ROOT/f'u_{i:02d}.wav'
        await edge_tts.Communicate(u['text'],voice=voice,rate=rate,pitch=pitch).save(str(mp3))
        decode_and_keep_natural_tail(mp3,wav)
    return used

used=asyncio.run(synthesize())

# Concatenate only at actual speaker/block changes. No artificial stop-start pauses.
concat='\n'.join(f"file 'u_{i:02d}.wav'" for i in range(len(UTTERANCES)))
(ROOT/'concat.txt').write_text(concat,encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c:a','pcm_s16le','voice_core.wav'],check=True,cwd=ROOT)

# 0.55 s meadow before title and 0.85 s atmosphere after the final spoken word.
for name,d in [('head.wav',0.55),('tail.wav',0.85)]:
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t',str(d),str(ROOT/name)],check=True)
(ROOT/'voice_full_concat.txt').write_text("file 'head.wav'\nfile 'voice_core.wav'\nfile 'tail.wav'\n",encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','voice_full_concat.txt','-c:a','pcm_s16le','voice_full.wav'],check=True,cwd=ROOT)

duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(ROOT/'voice_full.wav')],text=True))

# Real field recordings downloaded by workflow. Loop and shape them into a stable meadow bed.
subprocess.run([
    'ffmpeg','-loglevel','error','-y',
    '-stream_loop','-1','-i',str(ROOT/'birds.ogg'),
    '-stream_loop','-1','-i',str(ROOT/'stream.ogg'),
    '-filter_complex',
    f"[0:a]atrim=0:{duration},asetpts=N/SR/TB,highpass=f=350,lowpass=f=8500,volume=0.60[b];"
    f"[1:a]atrim=0:{duration},asetpts=N/SR/TB,highpass=f=120,lowpass=f=6500,volume=0.50[s];"
    "[b][s]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-27:TP=-5:LRA=7[bg]",
    '-map','[bg]','-ar','44100','-ac','2','-c:a','pcm_s16le',str(ROOT/'background.wav')
],check=True)

# Gentle ducking only: nature remains audible and bridges the speaker changes.
filter_complex=(
    '[0:a]loudnorm=I=-16:TP=-1.5:LRA=9,asplit=2[v1][v2];'
    '[1:a]volume=0.82[bg];'
    '[bg][v1]sidechaincompress=threshold=0.024:ratio=3.2:attack=35:release=760[duckbg];'
    '[v2][duckbg]amix=inputs=2:duration=first:weights=1 0.58:normalize=0,'
    'alimiter=limit=0.96[out]'
)
out=ROOT/'Сказка_о_Бабочке_ЖИВАЯ_плавная_v4.mp3'
subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(ROOT/'voice_full.wav'),'-i',str(ROOT/'background.wav'),'-filter_complex',filter_complex,'-map','[out]','-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','192k',str(out)],check=True)

source=' '.join(u['text'] for u in UTTERANCES)
(ROOT/'source_spoken.txt').write_text(source,encoding='utf-8')
report={
    'utterance_count':len(UTTERANCES),
    'narrator_long_blocks':sum(1 for u in UTTERANCES if u['role'] in ('narrator','narrator_final')),
    'final_sentence':'И чем чаще ты идёшь за добрым внутренним зовом, тем больше света появляется и в тебе, и вокруг тебя.',
    'voices':used,
    'voice_full_duration_seconds':round(duration,3),
    'construction':'long semantic narrator blocks; cuts only at speaker/block changes; natural TTS tails preserved; no inserted dialogue gaps; 0.85 s ambience after final word'
}
(ROOT/'render_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))