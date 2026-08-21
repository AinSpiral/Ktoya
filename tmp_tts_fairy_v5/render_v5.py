import asyncio, json, math, subprocess, wave
from pathlib import Path
import numpy as np
import edge_tts

ROOT=Path(__file__).parent; ROOT.mkdir(exist_ok=True)

UTTERANCES=[
('narrator_warm','Сказка о Бабочке, которая перестала искать колючки. Жила-была маленькая Бабочка. Она очень любила цветы. Но все вокруг учили её совсем другому.'),
('burdock','Если хочешь стать сильной, сначала полетай над колючками.'),
('butterfly_question','Почему?'),
('burdock','Потому что настоящий путь всегда трудный.'),
('narrator_sad','Тогда Бабочка летела к колючкам. Цеплялась за них крылышками. Уставала. Грустила. Но почему-то счастливее не становилась. Однажды она встретила старую Стрекозу. Та легко кружилась над цветущим лугом и весело смеялась.'),
('butterfly_question','Почему ты такая счастливая?'),
('dragonfly_wise','Потому что лечу туда, где мне хорошо.'),
('butterfly_doubt','Разве не нужно сначала пострадать?'),
('narrator_light','Стрекоза очень удивилась.'),
('dragonfly_wise','А кто тебе это сказал?'),
('butterfly_doubt','Все говорят...'),
('narrator_light','Стрекоза присела рядом.'),
('dragonfly_wise','Посмотри на пчёл. Они летят к цветам. Посмотри на птиц. Они летят туда, где тёплое солнце. Посмотри на ручей. Он течёт туда, где ему легко. Никто в природе специально не ищет место, где хуже.'),
('narrator_thoughtful','Бабочка задумалась.'),
('butterfly_doubt','Но если я буду лететь только к цветам... разве я не стану ленивой?'),
('narrator_light','Стрекоза рассмеялась.'),
('dragonfly_bright','Попробуй!'),
('narrator_bright','На следующее утро Бабочка решила провести необычный день. Она летела только туда, куда радостно отзывалось её сердце. На ромашки. Потом на василёк. Потом к ароматной лаванде. Она познакомилась с Пчёлкой. Помогла Божьей Коровке найти дорогу домой. Напоила Росинку солнечным светом. Поиграла с Ветерком. И вдруг заметила, что совсем не сидела без дела. Наоборот. Она сделала столько добрых дел, сколько раньше не успевала за целую неделю.'),
('narrator_light','Вечером Стрекоза спросила:'),
('dragonfly_bright','Ну что, ты весь день только отдыхала?'),
('narrator_light','Бабочка улыбнулась.'),
('butterfly_happy','Нет. Я просто всё время делала то, к чему меня звало сердце. И оказалось, что именно там меня уже ждали.'),
('narrator_final','С тех пор Бабочка перестала искать колючки специально. Если на пути они встречались, она аккуратно их облетала. А своё внимание снова направляла к цветам. И жители луга запомнили один важный секрет. Источник жизни похож на солнышко. Он светит не там, где больше страдают. Он светит там, где сердце раскрывается. И чем чаще ты идёшь за добрым внутренним зовом, тем больше света появляется и в тебе, и вокруг тебя.')]

VOICE='ru-RU-SvetlanaNeural'; DMITRY='ru-RU-DmitryNeural'
CFG={
'narrator_warm':(VOICE,'-8%','-2Hz'),'narrator_sad':(VOICE,'-11%','-5Hz'),'narrator_light':(VOICE,'-5%','+1Hz'),'narrator_thoughtful':(VOICE,'-12%','-3Hz'),'narrator_bright':(VOICE,'-4%','+2Hz'),'narrator_final':(VOICE,'-10%','-4Hz'),
'butterfly_question':(VOICE,'+4%','+12Hz'),'butterfly_doubt':(VOICE,'-2%','+9Hz'),'butterfly_happy':(VOICE,'+2%','+10Hz'),
'dragonfly_wise':(VOICE,'-7%','-8Hz'),'dragonfly_bright':(VOICE,'-1%','-5Hz'),'burdock':(DMITRY,'-8%','-11Hz')}

def decode_keep_tail(mp3,wav_out):
    tmp=wav_out.with_suffix('.raw.wav')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(mp3),'-ar','44100','-ac','1','-c:a','pcm_s16le',str(tmp)],check=True)
    with wave.open(str(tmp),'rb') as w: sr=w.getframerate(); data=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(float)/32768
    thr=10**(-74/20); idx=np.flatnonzero(np.abs(data)>thr)
    if len(idx):
        start=max(0,int(idx[0]-.05*sr)); end=min(len(data),int(idx[-1]+.48*sr)); data=data[start:end]
    f=min(int(.006*sr),len(data)//2)
    if f: data[:f]*=np.linspace(0,1,f,endpoint=False); data[-f:]*=np.linspace(1,0,f,endpoint=False)
    with wave.open(str(wav_out),'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
    tmp.unlink(missing_ok=True)

async def main():
    used=[]
    for i,(role,text) in enumerate(UTTERANCES):
        voice,rate,pitch=CFG[role]; used.append((role,voice,rate,pitch))
        mp3=ROOT/f'u_{i:02}.mp3'; wav=ROOT/f'u_{i:02}.wav'
        await edge_tts.Communicate(text,voice=voice,rate=rate,pitch=pitch).save(str(mp3)); decode_keep_tail(mp3,wav)
    return used
used=asyncio.run(main())

(ROOT/'concat.txt').write_text('\n'.join(f"file 'u_{i:02}.wav'" for i in range(len(UTTERANCES))),encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c:a','pcm_s16le','voice_core.wav'],cwd=ROOT,check=True)
for n,d in [('head.wav',.55),('postvoice.wav',.35),('finalsilence.wav',1.35)]:
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t',str(d),str(ROOT/n)],check=True)
(ROOT/'vf.txt').write_text("file 'head.wav'\nfile 'voice_core.wav'\nfile 'postvoice.wav'\n",encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','vf.txt','-c:a','pcm_s16le','voice_with_head.wav'],cwd=ROOT,check=True)
dur=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(ROOT/'voice_with_head.wav')],text=True))
subprocess.run(['ffmpeg','-loglevel','error','-y','-stream_loop','-1','-i',str(ROOT/'birds.ogg'),'-stream_loop','-1','-i',str(ROOT/'stream.ogg'),'-filter_complex',f"[0:a]atrim=0:{dur},asetpts=N/SR/TB,highpass=f=350,lowpass=f=8500,volume=.58[b];[1:a]atrim=0:{dur},asetpts=N/SR/TB,highpass=f=120,lowpass=f=6500,volume=.48[s];[b][s]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-27:TP=-5:LRA=7,afade=t=out:st={max(0,dur-.6)}:d=0.6[bg]",'-map','[bg]','-ar','44100','-ac','2','-c:a','pcm_s16le',str(ROOT/'background.wav')],check=True)
flt='[0:a]loudnorm=I=-16:TP=-1.5:LRA=9,asplit=2[v1][v2];[1:a]volume=.82[bg];[bg][v1]sidechaincompress=threshold=.024:ratio=3:attack=35:release=700[duck];[v2][duck]amix=inputs=2:duration=first:weights=1 .58:normalize=0,alimiter=limit=.96[m]'
subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(ROOT/'voice_with_head.wav'),'-i',str(ROOT/'background.wav'),'-filter_complex',flt,'-map','[m]','-ar','44100','-ac','2','-c:a','pcm_s16le',str(ROOT/'mixed.wav')],check=True)
(ROOT/'final_concat.txt').write_text("file 'mixed.wav'\nfile 'finalsilence.wav'\n",encoding='utf-8')
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','concat','-safe','0','-i','final_concat.txt','-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','192k',str(ROOT/'Сказка_о_Бабочке_сонная_v5.mp3')],cwd=ROOT,check=True)
(ROOT/'source_spoken.txt').write_text(' '.join(t for _,t in UTTERANCES),encoding='utf-8')
(ROOT/'render_report.json').write_text(json.dumps({'voices':used,'ending_silence_seconds':1.35,'final_sentence':UTTERANCES[-1][1].split('.')[-2].strip()},ensure_ascii=False,indent=2),encoding='utf-8')