import json, re, os, wave, shutil, subprocess
from pathlib import Path
from difflib import SequenceMatcher
ROOT=Path(__file__).resolve().parent.parent; DATA=ROOT/'tts_tmp'; WORK=ROOT/'tts_work'; RESULT=ROOT/'tts_result'; VOICES=ROOT/'voices'
for d in (WORK,RESULT,VOICES): d.mkdir(exist_ok=True)
pairs=[]
for p in sorted(DATA.glob('pairs_*.json')): pairs.extend(json.loads(p.read_text(encoding='utf-8')))
assert len(pairs)==281
nums=[x['n'] for x in pairs]; assert len(set(nums))==281 and set(nums)==set(range(1,282))
def speech(s):
 s=s.replace('\u00a0',' ').replace('№',' номер ').replace('—',' - ').replace('–',' - ').replace('Hе ','Не ')
 reps=[(r'\bTN-C-S\b','ти эн си эс'),(r'\bTN-C\b','ти эн си'),(r'\bTN-S\b','ти эн эс'),(r'\bTN\b','ти эн'),(r'\bTT\b','ти ти'),(r'\bIT\b','ай ти'),(r'\bPEN\b','пэ э эн'),(r'\bPE\b','пэ э'),(r'\bРЕ\b','пэ э'),(r'\bВЛИ\b','вэ эл и'),(r'\bВЛЗ\b','вэ эл зэ'),(r'\bВЛ\b','вэ эл'),(r'\bЛЭП\b','линия электропередачи'),(r'\bОРУ\b','о эр у'),(r'\bЗРУ\b','зэ эр у'),(r'\bРУ\b','эр у'),(r'\bПУЭ\b','пэ у э'),(r'\bПТЭЭП\b','пэ тэ э э пэ'),(r'\bПОТЭЭ\b','пэ о тэ э э'),(r'\bОРД\b','о эр дэ'),(r'\bСИЗ\b','эс и зэ'),(r'\bУЗО\b','у зэ о'),(r'\bСИП\b','эс и пэ'),(r'\bРЗА\b','эр зэ а'),(r'\bАВР\b','а вэ эр'),(r'\bКЗ\b','ка зэ'),(r'\bКЛ\b','ка эл'),(r'\bТП\b','тэ пэ')]
 for pat,rep in reps: s=re.sub(pat,rep,s)
 units=[('кВт','киловатт'),('МВт','мегаватт'),('кВ','киловольт'),('В','вольт'),('мА','миллиампер'),('А','ампер'),('кОм','килоом'),('Ом','ом')]
 for unit,word in units: s=re.sub(rf'(\d+(?:[,.]\d+)?)\s*[-–—]\s*(\d+(?:[,.]\d+)?)\s*{re.escape(unit)}\b',rf'от \1 до \2 {word}',s)
 rr=[(r'(\d+(?:[,.]\d+)?)\s*кВт\b',r'\1 киловатт'),(r'(\d+(?:[,.]\d+)?)\s*МВт\b',r'\1 мегаватт'),(r'(\d+(?:[,.]\d+)?)\s*кВ\b',r'\1 киловольт'),(r'(\d+(?:[,.]\d+)?)\s*В\b',r'\1 вольт'),(r'(\d+(?:[,.]\d+)?)\s*мА\b',r'\1 миллиампер'),(r'(\d+(?:[,.]\d+)?)\s*А\b',r'\1 ампер'),(r'(\d+(?:[,.]\d+)?)\s*кОм\b',r'\1 килоом'),(r'(\d+(?:[,.]\d+)?)\s*Ом\b',r'\1 ом'),(r'(\d+(?:[,.]\d+)?)\s*мм(?:2|²)\b',r'\1 квадратных миллиметров'),(r'(\d+(?:[,.]\d+)?)\s*м(?:2|²)\b',r'\1 квадратных метров'),(r'(\d+(?:[,.]\d+)?)\s*мм\b',r'\1 миллиметров'),(r'(\d+(?:[,.]\d+)?)\s*м\b',r'\1 метров'),(r'(\d+(?:[,.]\d+)?)\s*%\b',r'\1 процентов')]
 for pat,rep in rr: s=re.sub(pat,rep,s)
 for old,new in [('VIII','восемь'),('VII','семь'),('VI','шесть'),('IV','четыре'),('III','три'),('II','два'),('V','пять'),('I','один')]: s=re.sub(rf'(?<![A-Za-zА-Яа-я]){old}(?![A-Za-zА-Яа-я])',new,s)
 s=re.sub(r'(?<=\d)н\b',' эн',s); s=re.sub(r'\bг\.(?=\s|$)','года',s); return re.sub(r'\s+',' ',s).strip()
all_speech='\n'.join(speech(x['q'])+' '+speech(x['a']) for x in pairs).lower()
for bad in ['вольт сопровождении','вольт случае','вольт любом','вольт соответствии','вольт электроустановках','вольт порядке','вольт котором']: assert bad not in all_speech,bad
def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-zа-я0-9]+',' ',s.lower().replace('ё','е'))).strip()
def score(e,g): return SequenceMatcher(None,norm(e),norm(g)).ratio()
def readwav(p):
 with wave.open(str(p),'rb') as w: return w.getparams(),w.readframes(w.getnframes())
def silence(p,sec): return b'\x00'*int(p.framerate*sec)*p.nchannels*p.sampwidth
def synth(voice,text,out,scale):
 from piper import SynthesisConfig
 with wave.open(str(out),'wb') as w: voice.synthesize_wav(text,w,syn_config=SynthesisConfig(length_scale=scale,noise_scale=0.667,noise_w_scale=0.8))
def make_pair(voice,pair,out,scale):
 q=WORK/'_q.wav'; a=WORK/'_a.wav'; synth(voice,f"Вопрос номер {pair['n']}. {speech(pair['q'])}",q,scale); synth(voice,f"Ответ. {speech(pair['a'])}",a,scale)
 qp,qf=readwav(q); ap,af=readwav(a); assert (qp.nchannels,qp.sampwidth,qp.framerate)==(ap.nchannels,ap.sampwidth,ap.framerate)
 with wave.open(str(out),'wb') as w: w.setparams(qp); w.writeframes(qf); w.writeframes(silence(qp,.85)); w.writeframes(af); w.writeframes(silence(qp,1.15))
 return f"Вопрос номер {pair['n']}. {speech(pair['q'])} Ответ. {speech(pair['a'])}"
def load(name):
 from piper import PiperVoice
 return PiperVoice.load(str(VOICES/f'{name}.onnx'))
from faster_whisper import WhisperModel
asr=WhisperModel('base',device='cpu',compute_type='int8')
def transcribe(p):
 segs,_=asr.transcribe(str(p),language='ru',beam_size=5,vad_filter=True); return ' '.join(s.text.strip() for s in segs).strip()
by={p['n']:p for p in pairs}; tests=[by[22],by[2],by[141]]; voices=['ru_RU-dmitri-medium','ru_RU-denis-medium','ru_RU-irina-medium']; scales=[1.00,1.12,1.24]; results=[]
for vn in voices:
 v=load(vn)
 for sc in scales:
  scores=[]; transcripts=[]
  for tp in tests:
   out=WORK/f'test_{vn}_{sc}_{tp["n"]}.wav'; exp=make_pair(v,tp,out,sc); got=transcribe(out); scores.append(score(exp,got)); transcripts.append((tp['n'],got))
  results.append({'voice':vn,'scale':sc,'avg':sum(scores)/len(scores),'min':min(scores),'scores':scores,'transcripts':transcripts})
results.sort(key=lambda x:(x['avg'],x['min']),reverse=True); report=['КОНТРОЛЬ РАЗБОРЧИВОСТИ ДО ПОЛНОЙ ЗАПИСИ']
for r in results:
 report.append(f"{r['voice']} scale={r['scale']:.2f}: avg={r['avg']:.3f}, min={r['min']:.3f}")
 for n,t in r['transcripts']: report.append(f'  Q{n} ASR: {t}')
best=results[0]; report.append(f"ВЫБРАНО: {best['voice']} scale={best['scale']:.2f}")
if best['avg']<.72 or best['min']<.55: (RESULT/'verification_report.txt').write_text('\n'.join(report),encoding='utf-8'); raise SystemExit('No candidate reached intelligibility threshold')
def build(cand,attempt):
 d=WORK/f'pairs_attempt_{attempt}'; shutil.rmtree(d,ignore_errors=True); d.mkdir(); v=load(cand['voice']); expected=[]; files=[]
 for idx,p in enumerate(pairs):
  out=d/f'{idx+1:03d}_q{p["n"]}.wav'; expected.append(make_pair(v,p,out,cand['scale'])); files.append(out)
 p0,_=readwav(files[0]); full=RESULT/'Шпаргалка_3_группа_281_вопрос_ответ.wav'
 with wave.open(str(full),'wb') as w:
  w.setparams(p0)
  for f in files:
   p,fr=readwav(f); assert (p.nchannels,p.sampwidth,p.framerate)==(p0.nchannels,p0.sampwidth,p0.framerate); w.writeframes(fr)
 inds=sorted(set(round(i*(len(files)-1)/19) for i in range(20))); scores=[]
 for idx in inds:
  got=transcribe(files[idx]); sv=score(expected[idx],got); scores.append(sv); report.append(f"FINAL SAMPLE pos={idx+1} q={pairs[idx]['n']} score={sv:.3f} ASR: {got}")
 return full,scores
chosen=full=fs=None
for attempt,cand in enumerate(results[:3],1):
 report.append(f"FULL ATTEMPT {attempt}: {cand['voice']} scale={cand['scale']:.2f}"); full,scores=build(cand,attempt); av=sum(scores)/len(scores); mn=min(scores); report.append(f"FINAL ASR: avg={av:.3f}, min={mn:.3f}, samples={len(scores)}")
 if av>=.72 and mn>=.45: chosen=cand; fs=scores; break
if chosen is None: (RESULT/'verification_report.txt').write_text('\n'.join(report),encoding='utf-8'); raise SystemExit('Full recording did not pass sampled intelligibility check')
mp3=RESULT/'Шпаргалка_3_группа_281_вопрос_ответ.mp3'; subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(full),'-ac','1','-ar','22050','-codec:a','libmp3lame','-b:a','96k',str(mp3)],check=True)
def duration(p): return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(p)],capture_output=True,text=True,check=True).stdout.strip())
with wave.open(str(full),'rb') as w: wd=w.getnframes()/w.getframerate()
md=duration(mp3); assert abs(wd-md)<2
report += ['', 'ИТОГ',f'Пар вопрос-ответ: {len(pairs)}',f'Выбранный голос: {chosen["voice"]}',f'length_scale: {chosen["scale"]:.2f}',f'Длительность WAV: {wd/60:.2f} мин',f'Длительность MP3: {md/60:.2f} мин',f'Финальная выборочная ASR-проверка: avg={sum(fs)/len(fs):.3f}, min={min(fs):.3f}, samples={len(fs)}','Ошибочных системных замен предлога «В» на «вольт»: 0','MP3 создан и длительность сверена с исходным WAV.']
(RESULT/'verification_report.txt').write_text('\n'.join(report),encoding='utf-8'); shutil.copy2(WORK/f'test_{best["voice"]}_{best["scale"]}_22.wav',RESULT/'контрольный_фрагмент.wav'); full.unlink(); print('\n'.join(report[-10:]))
