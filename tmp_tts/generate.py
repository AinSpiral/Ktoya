import asyncio, json, os, re, subprocess, sys, time, unicodedata
from pathlib import Path

import edge_tts
from faster_whisper import WhisperModel
from rapidfuzz.fuzz import ratio

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
PARTS = OUT / "parts"
OUT.mkdir(exist_ok=True)
PARTS.mkdir(exist_ok=True)
VOICE = "ru-RU-DmitryNeural"

pairs = json.loads((ROOT / "tts_pairs.json").read_text(encoding="utf-8"))
assert len(pairs) == 281, len(pairs)
assert len({p['n'] for p in pairs}) == 281

ABBR = [
    (r"\bTN-C-S\b", "ти эн си эс"), (r"\bTN-C\b", "ти эн си"), (r"\bTN-S\b", "ти эн эс"),
    (r"\bTN\b", "ти эн"), (r"\bTT\b", "ти ти"), (r"\bIT\b", "ай ти"),
    (r"\bPEN\b", "пэ е эн"), (r"\bPE\b", "пэ е"),
    (r"\bВЛИ\b", "вэ эл и"), (r"\bВЛЗ\b", "вэ эл зэ"), (r"\bВЛ\b", "вэ эл"),
    (r"\bОРУ\b", "о эр у"), (r"\bЗРУ\b", "зэ эр у"), (r"\bРУ\b", "эр у"),
    (r"\bПУЭ\b", "пэ у э"), (r"\bПТЭЭП\b", "пэ тэ э э пэ"), (r"\bПОТЭЭ\b", "пэ о тэ э э"),
    (r"\bОРД\b", "о эр дэ"), (r"\bСИЗ\b", "эс и зэ"), (r"\bУЗО\b", "у зэ о"),
    (r"\bСИП\b", "эс и пэ"), (r"\bРЗА\b", "эр зэ а"), (r"\bАВР\b", "а вэ эр"),
    (r"\bКЗ\b", "ка зэ"), (r"\bКЛ\b", "ка эл"), (r"\bТП\b", "тэ пэ")
]

UNITS = [
    (r"(\d+(?:[,.]\d+)?)\s*кВт\b", r"\1 киловатт"), (r"(\d+(?:[,.]\d+)?)\s*МВт\b", r"\1 мегаватт"),
    (r"(\d+(?:[,.]\d+)?)\s*кВ\b", r"\1 киловольт"), (r"(\d+(?:[,.]\d+)?)\s*В\b", r"\1 вольт"),
    (r"(\d+(?:[,.]\d+)?)\s*мА\b", r"\1 миллиампер"), (r"(\d+(?:[,.]\d+)?)\s*А\b", r"\1 ампер"),
    (r"(\d+(?:[,.]\d+)?)\s*кОм\b", r"\1 килоом"), (r"(\d+(?:[,.]\d+)?)\s*Ом\b", r"\1 ом"),
    (r"(\d+(?:[,.]\d+)?)\s*мм(?:2|²)\b", r"\1 квадратных миллиметров"),
    (r"(\d+(?:[,.]\d+)?)\s*мм\b", r"\1 миллиметров"),
    (r"(\d+(?:[,.]\d+)?)\s*м(?:2|²)\b", r"\1 квадратных метров"),
    (r"(\d+(?:[,.]\d+)?)\s*м\b", r"\1 метров"),
    (r"(\d+(?:[,.]\d+)?)\s*%\b", r"\1 процентов")
]

ROMAN = [("VIII","восемь"),("VII","семь"),("VI","шесть"),("IV","четыре"),("III","три"),("II","два"),("V","пять"),("I","один")]

def speech_text(s: str) -> str:
    s = s.replace("№", "номер ").replace("—", " - ").replace("–", " - ")
    for p, r in ABBR:
        s = re.sub(p, r, s)
    for p, r in UNITS:
        s = re.sub(p, r, s)
    for old, new in ROMAN:
        s = re.sub(rf"(?<![A-Za-zА-Яа-я]){old}(?![A-Za-zА-Яа-я])", new, s)
    s = re.sub(r"(?<=\d)н\b", " эн", s)
    s = re.sub(r"\bг\.(?=\s|$)", "года", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

# Guard against the old bug where preposition В became 'вольт'.
all_spoken = "\n".join(speech_text(p['q']) + "\n" + speech_text(p['a']) for p in pairs).lower()
for bad in ["вольт сопровождении", "вольт случае", "вольт любом", "вольт соответствии", "вольт электроустановках"]:
    assert bad not in all_spoken, bad

async def synth_one(text: str, path: Path, rate: str, sem: asyncio.Semaphore):
    for attempt in range(6):
        try:
            async with sem:
                await edge_tts.Communicate(text=text, voice=VOICE, rate=rate).save(str(path))
            if path.exists() and path.stat().st_size > 1000:
                return
        except Exception as e:
            if attempt == 5:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"TTS failed: {path}")

def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str,args)], check=True)

def make_silence(path: Path, seconds: float):
    ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(seconds), "-c:a", "libmp3lame", "-b:a", "64k", path)

def concat_mp3(files, out):
    lst = out.with_suffix(".txt")
    lst.write_text("\n".join("file '" + str(Path(f).resolve()).replace("'", "'\\''") + "'" for f in files), encoding="utf-8")
    ffmpeg("-f", "concat", "-safe", "0", "-i", lst, "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "24000", "-ac", "1", out)

def norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = unicodedata.normalize("NFKD", s)
    s = re.sub(r"[^0-9a-zа-я]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def transcribe(model, path: Path):
    segs, _ = model.transcribe(str(path), language="ru", beam_size=1, vad_filter=True)
    return " ".join(s.text.strip() for s in segs).strip()

async def test_rate(rate: str, model):
    sample = next(p for p in pairs if p['n'] == 22)
    d = OUT / "test"
    d.mkdir(exist_ok=True)
    q = d / f"q_{rate.replace('%','').replace('-','m')}.mp3"
    a = d / f"a_{rate.replace('%','').replace('-','m')}.mp3"
    sem = asyncio.Semaphore(2)
    qt = "Вопрос. " + speech_text(sample['q'])
    at = "Ответ. " + speech_text(sample['a'])
    await asyncio.gather(synth_one(qt,q,rate,sem), synth_one(at,a,rate,sem))
    pause = d / "pause.mp3"
    if not pause.exists(): make_silence(pause, 0.9)
    combined = d / f"sample_{rate.replace('%','').replace('-','m')}.mp3"
    concat_mp3([q,pause,a], combined)
    got = transcribe(model, combined)
    exp = qt + " " + at
    score = ratio(norm(exp), norm(got))
    print(f"RATE {rate}: score={score:.1f}\nEXPECTED={exp}\nASR={got}", flush=True)
    return score, rate

async def main():
    print("Loading Whisper base model for intelligibility checks...", flush=True)
    model = WhisperModel("base", device="cpu", compute_type="int8")
    candidates = []
    for rate in ["-5%", "-12%", "-18%"]:
        candidates.append(await test_rate(rate, model))
    best_score, rate = max(candidates)
    if best_score < 70:
        raise RuntimeError(f"Short sample is not intelligible enough, best ASR score {best_score:.1f}")
    print(f"Selected rate {rate}, short-sample score {best_score:.1f}", flush=True)

    sem = asyncio.Semaphore(5)
    jobs=[]
    for idx,p in enumerate(pairs):
        qpath=PARTS/f"{idx:03d}_q.mp3"; apath=PARTS/f"{idx:03d}_a.mp3"
        jobs.append(synth_one("Вопрос номер " + str(p['n']) + ". " + speech_text(p['q']), qpath, rate, sem))
        jobs.append(synth_one("Ответ. " + speech_text(p['a']), apath, rate, sem))
    # Work in batches to reduce transient service failures.
    for i in range(0,len(jobs),40):
        await asyncio.gather(*jobs[i:i+40])
        print(f"TTS fragments: {min(i+40,len(jobs))}/{len(jobs)}", flush=True)

    # Verify every spoken pair by ASR. Low-scoring pairs are regenerated slower once.
    scores=[]; bad=[]
    pause_q=OUT/"pause_q.mp3"; pause_pair=OUT/"pause_pair.mp3"
    make_silence(pause_q,0.85); make_silence(pause_pair,1.15)
    pairclips=OUT/"pairclips"; pairclips.mkdir(exist_ok=True)
    for idx,p in enumerate(pairs):
        clip=pairclips/f"{idx:03d}.mp3"
        concat_mp3([PARTS/f"{idx:03d}_q.mp3",pause_q,PARTS/f"{idx:03d}_a.mp3"],clip)
        got=transcribe(model,clip)
        exp="Вопрос номер "+str(p['n'])+". "+speech_text(p['q'])+" Ответ. "+speech_text(p['a'])
        sc=ratio(norm(exp),norm(got)); scores.append(sc)
        if sc < 58: bad.append((idx,p,sc,got))
        if (idx+1)%25==0: print(f"ASR checked {idx+1}/281; mean={sum(scores)/len(scores):.1f}; low={len(bad)}",flush=True)

    if bad:
        print(f"Regenerating {len(bad)} low-score pairs at slower rate -22%", flush=True)
        sem2=asyncio.Semaphore(3)
        for idx,p,sc,got in bad:
            await synth_one("Вопрос номер "+str(p['n'])+". "+speech_text(p['q']),PARTS/f"{idx:03d}_q.mp3","-22%",sem2)
            await synth_one("Ответ. "+speech_text(p['a']),PARTS/f"{idx:03d}_a.mp3","-22%",sem2)
            clip=pairclips/f"{idx:03d}.mp3"
            concat_mp3([PARTS/f"{idx:03d}_q.mp3",pause_q,PARTS/f"{idx:03d}_a.mp3"],clip)
            got2=transcribe(model,clip)
            exp="Вопрос номер "+str(p['n'])+". "+speech_text(p['q'])+" Ответ. "+speech_text(p['a'])
            sc2=ratio(norm(exp),norm(got2))
            scores[idx]=sc2
            print(f"Retry pair n={p['n']}: {sc:.1f} -> {sc2:.1f}",flush=True)

    # Final assembly in exact document order.
    sequence=[]
    for idx in range(len(pairs)):
        sequence += [PARTS/f"{idx:03d}_q.mp3", pause_q, PARTS/f"{idx:03d}_a.mp3", pause_pair]
    final=OUT/"Шпаргалка_3_группа_281_вопрос_ответ_нейроголос.mp3"
    concat_mp3(sequence,final)

    # Technical integrity checks.
    dur=float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(final)],text=True).strip())
    if dur < 1800: raise RuntimeError(f"Unexpectedly short final duration: {dur}")
    if final.stat().st_size < 5_000_000: raise RuntimeError("Final MP3 unexpectedly small")
    report={
        "pairs":len(pairs),"fragments":len(pairs)*2,"selected_rate":rate,"sample_score":best_score,
        "asr_mean":sum(scores)/len(scores),"asr_min":min(scores),"pairs_below_58_after_retry":sum(1 for x in scores if x<58),
        "duration_seconds":dur,"size_bytes":final.stat().st_size
    }
    (OUT/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

asyncio.run(main())
