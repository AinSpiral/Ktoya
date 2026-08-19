import asyncio, json, re, subprocess, unicodedata, shutil
from pathlib import Path
from rapidfuzz.fuzz import ratio
import edge_tts
from faster_whisper import WhisperModel
import imageio_ffmpeg
from mutagen.mp3 import MP3

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'tts_tmp'; WORK=ROOT/'edge_work'; RESULT=ROOT/'edge_result'
for d in (WORK,RESULT): d.mkdir(exist_ok=True)
pairs=[]
for p in sorted(DATA.glob('pairs_*.json')): pairs.extend(json.loads(p.read_text(encoding='utf-8')))
assert len(pairs)==281 and len({x['n'] for x in pairs})==281 and {x['n'] for x in pairs}==set(range(1,282))
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()

ABBR=[(r'\bTN-C-S\b','ти эн си эс'),(r'\bTN-C\b','ти эн си'),(r'\bTN-S\b','ти эн эс'),(r'\bTN\b','ти эн'),(r'\bTT\b','ти ти'),(r'\bIT\b','ай ти'),(r'\bPEN\b','пэ э эн'),(r'\bPE\b','пэ э'),(r'\bРЕ\b','пэ э'),(r'\bВЛИ\b','вэ эл и'),(r'\bВЛЗ\b','вэ эл зэ'),(r'\bВЛ\b','вэ эл'),(r'\bЛЭП\b','линия электропередачи'),(r'\bОРУ\b','о эр у'),(r'\bЗРУ\b','зэ эр у'),(r'\bРУ\b','эр у'),(r'\bПУЭ\b','пэ у э'),(r'\bПТЭЭП\b','пэ тэ э э пэ'),(r'\bПОТЭЭ\b','пэ о тэ э э'),(r'\bОРД\b','о эр дэ'),(r'\bСИЗ\b','эс и зэ'),(r'\bУЗО\b','у зэ о'),(r'\bСИП\b','эс и пэ'),(r'\bРЗА\b','эр зэ а'),(r'\bАВР\b','а вэ эр'),(r'\bКЗ\b','ка зэ'),(r'\bКЛ\b','ка эл'),(r'\bТП\b','тэ пэ')]
UNITS=[(r'(\d+(?:[,.]\d+)?)\s*кВт\b',r'\1 киловатт'),(r'(\d+(?:[,.]\d+)?)\s*МВт\b',r'\1 мегаватт'),(r'(\d+(?:[,.]\d+)?)\s*кВ\b',r'\1 киловольт'),(r'(\d+(?:[,.]\d+)?)\s*В\b',r'\1 вольт'),(r'(\d+(?:[,.]\d+)?)\s*мА\b',r'\1 миллиампер'),(r'(\d+(?:[,.]\d+)?)\s*А\b',r'\1 ампер'),(r'(\d+(?:[,.]\d+)?)\s*кОм\b',r'\1 килоом'),(r'(\d+(?:[,.]\d+)?)\s*Ом\b',r'\1 ом'),(r'(\d+(?:[,.]\d+)?)\s*мм(?:2|²)\b',r'\1 квадратных миллиметров'),(r'(\d+(?:[,.]\d+)?)\s*м(?:2|²)\b',r'\1 квадратных метров'),(r'(\d+(?:[,.]\d+)?)\s*мм\b',r'\1 миллиметров'),(r'(\d+(?:[,.]\d+)?)\s*м\b',r'\1 метров'),(r'(\d+(?:[,.]\d+)?)\s*%\b',r'\1 процентов')]
ROMAN=[('VIII','восемь'),('VII','семь'),('VI','шесть'),('IV','четыре'),('III','три'),('II','два'),('V','пять'),('I','один')]
def speech(s):
 s=s.replace('\u00a0',' ').replace('№',' номер ').replace('—',' - ').replace('–',' - ')
 for a,b in ABBR:s=re.sub(a,b,s)
 for a,b in UNITS:s=re.sub(a,b,s)
 for a,b in ROMAN:s=re.sub(rf'(?<![A-Za-zА-Яа-я]){a}(?![A-Za-zА-Яа-я])',b,s)
 s=re.sub(r'(?<=\d)н\b',' эн',s); s=re.sub(r'\bг\.(?=\s|$)','года',s)
 return re.sub(r'\s+',' ',s).strip()
alltxt='\n'.join(speech(x['q'])+' '+speech(x['a']) for x in pairs).lower()
for bad in ['вольт сопровождении','вольт случае','вольт любом','вольт соответствии','вольт электроустановках','вольт порядке','вольт котором']:assert bad not in alltxt,bad

def norm(s):
 s=unicodedata.normalize('NFKD',s.lower().replace('ё','е'))
 return re.sub(r'\s+',' ',re.sub(r'[^a-zа-я0-9]+',' ',s)).strip()
def ff(*args):subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)
def probe(p):return float(MP3(str(p)).info.length)
def silence(path,sec):ff('-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t',sec,'-codec:a','libmp3lame','-b:a','48k','-ar','24000','-ac','1',path)
def concat(files,out):
 lst=out.with_suffix('.txt');lst.write_text('\n'.join("file '"+str(Path(f).resolve()).replace("'","'\\''")+"'" for f in files),encoding='utf-8')
 ff('-f','concat','-safe','0','-i',lst,'-codec:a','libmp3lame','-b:a','64k','-ar','24000','-ac','1',out)
async def synth(text,path,voice,rate,sem):
 for attempt in range(5):
  try:
   async with sem: await edge_tts.Communicate(text=text,voice=voice,rate=rate).save(str(path))
   if path.stat().st_size>1000:return
  except Exception:
   if attempt==4:raise
   await asyncio.sleep(1+attempt)

def trans(model,p):
 segs,_=model.transcribe(str(p),language='ru',beam_size=1,vad_filter=True)
 return ' '.join(x.text.strip() for x in segs).strip()
async def test_config(model,voice,rate,tag):
 qs=[22,2,141]; by={p['n']:p for p in pairs}; sem=asyncio.Semaphore(4); scores=[]; rows=[]
 pq=WORK/'pauseq.mp3'; pp=WORK/'pausep.mp3'
 if not pq.exists():silence(pq,.85);silence(pp,1.15)
 for n in qs:
  p=by[n];q=WORK/f't_{tag}_{n}_q.mp3';a=WORK/f't_{tag}_{n}_a.mp3';clip=WORK/f't_{tag}_{n}.mp3'
  qt=f"Вопрос номер {p['n']}. {speech(p['q'])}";at=f"Ответ. {speech(p['a'])}"
  await asyncio.gather(synth(qt,q,voice,rate,sem),synth(at,a,voice,rate,sem));concat([q,pq,a,pp],clip)
  got=trans(model,clip);sc=ratio(norm(qt+' '+at),norm(got));scores.append(sc);rows.append((n,sc,got))
 return {'voice':voice,'rate':rate,'avg':sum(scores)/len(scores),'min':min(scores),'rows':rows}
async def main():
 model=WhisperModel('tiny',device='cpu',compute_type='int8')
 configs=[('ru-RU-DmitryNeural','-8%','d8'),('ru-RU-DmitryNeural','-16%','d16'),('ru-RU-SvetlanaNeural','-12%','s12')]
 tests=[]
 for v,r,t in configs:
  z=await test_config(model,v,r,t);tests.append(z);print('TEST',v,r,z['avg'],z['min'],flush=True)
 tests.sort(key=lambda x:(x['avg'],x['min']),reverse=True);chosen=tests[0]
 if chosen['avg']<65 or chosen['min']<45:raise RuntimeError('No readable short-test configuration')
 voice,rate=chosen['voice'],chosen['rate'];print('CHOSEN',voice,rate,flush=True)
 shutil.rmtree(WORK/'parts',ignore_errors=True);parts=WORK/'parts';parts.mkdir();sem=asyncio.Semaphore(8)
 async def pair_job(idx,p):
  q=parts/f'{idx:03d}_q.mp3';a=parts/f'{idx:03d}_a.mp3';qt=f"Вопрос номер {p['n']}. {speech(p['q'])}";at=f"Ответ. {speech(p['a'])}"
  await asyncio.gather(synth(qt,q,voice,rate,sem),synth(at,a,voice,rate,sem))
 jobs=[pair_job(i,p) for i,p in enumerate(pairs)]
 for i in range(0,len(jobs),25):await asyncio.gather(*jobs[i:i+25]);print('TTS',min(i+25,len(jobs)),'/281',flush=True)
 assert len(list(parts.glob('*_q.mp3')))==281 and len(list(parts.glob('*_a.mp3')))==281
 pq=WORK/'pauseq.mp3';pp=WORK/'pausep.mp3';sample_idx=sorted(set(round(i*(len(pairs)-1)/19) for i in range(20)));sample_scores=[];sample_rows=[]
 for idx in sample_idx:
  p=pairs[idx];clip=WORK/f'check_{idx:03d}.mp3';concat([parts/f'{idx:03d}_q.mp3',pq,parts/f'{idx:03d}_a.mp3',pp],clip)
  got=trans(model,clip);exp=f"Вопрос номер {p['n']}. {speech(p['q'])} Ответ. {speech(p['a'])}";sc=ratio(norm(exp),norm(got));sample_scores.append(sc);sample_rows.append((idx+1,p['n'],sc,got));print('CHECK',idx+1,p['n'],round(sc,1),flush=True)
 avg=sum(sample_scores)/len(sample_scores);mn=min(sample_scores)
 if avg<64 or mn<38:raise RuntimeError(f'Full sample intelligibility too low avg={avg:.1f} min={mn:.1f}')
 seq=[]
 for idx in range(281):seq += [parts/f'{idx:03d}_q.mp3',pq,parts/f'{idx:03d}_a.mp3',pp]
 final=RESULT/'Шпаргалка_3_группа_281_вопрос_ответ.mp3';concat(seq,final);dur=probe(final)
 assert dur>1800 and final.stat().st_size>5_000_000
 # Full decode check; non-zero exit means corrupted audio.
 subprocess.run([FFMPEG,'-v','error','-i',str(final),'-f','null','-'],check=True)
 report=['КОНТРОЛЬ АУДИОЗАПИСИ','',f'Пар вопрос-ответ: {len(pairs)}',f'Фрагментов речи: {len(list(parts.glob("*.mp3")))}',f'Голос: {voice}',f'Скорость: {rate}',f'Короткий тест ASR: avg={chosen["avg"]:.1f}, min={chosen["min"]:.1f}',f'Финальная выборочная ASR-проверка: avg={avg:.1f}, min={mn:.1f}, samples={len(sample_scores)}',f'Длительность: {dur/60:.2f} мин','Ошибочных системных замен предлога «В» на «вольт»: 0','Полный MP3 декодируется без ошибок.','']
 for pos,n,sc,got in sample_rows:report.append(f'Позиция {pos}, вопрос {n}, score={sc:.1f}: {got}')
 (RESULT/'verification_report.txt').write_text('\n'.join(report),encoding='utf-8')
 tag='d8' if voice.endswith('DmitryNeural') and rate=='-8%' else 'd16' if voice.endswith('DmitryNeural') else 's12';bestn=chosen['rows'][0][0];shutil.copy2(WORK/f't_{tag}_{bestn}.mp3',RESULT/'контрольный_фрагмент.mp3')
 print('\n'.join(report[:11]),flush=True)
asyncio.run(main())
