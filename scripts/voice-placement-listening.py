# Озвучка аудирования вводного теста (локально, без внешних сервисов).
#
# Модель — Kokoro-82M (Apache-2.0). Отсюда HuggingFace недоступен, поэтому всё берётся из npm и PyPI:
#   npm pack kokoro-q8-shards@1.0.0 kokoro-js@1.2.1          # веса (6 частей) и голоса
#   cat package/kokoro-q8.part{0..5}.bin > model_quantized.onnx
#   sha256 должен быть fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478
#   python -m venv ttsenv && ttsenv/bin/pip install kokoro-onnx soundfile   # + ffmpeg в системе
#   ttsenv/bin/python -I scripts/voice-placement-listening.py --build-voices <kokoro-js/package/voices> voices.npz
# Озвучка файла банка (mp3 кладутся в content/placement/audio/<id>.mp3):
#   ttsenv/bin/python -I scripts/voice-placement-listening.py model_quantized.onnx voices.npz content/placement/audio content/placement/10_listening_A1_A2.json [id …]
# Голоса выбраны на слух: женский британский bf_emma, мужской британский bm_fable,
# женский американский af_heart, мужской американский am_michael.
import json, re, subprocess, sys, os
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

if sys.argv[1] == "--build-voices":  # голоса kokoro-js (*.bin) → один voices.npz
    import glob
    v = {os.path.basename(f)[:-4]: np.fromfile(f, dtype=np.float32).reshape(510, 1, 256)
         for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.bin"))) if os.path.basename(f)[:2] in ("af", "am", "bf", "bm")}
    np.savez(sys.argv[3], **v)
    sys.exit(print(len(v), "голосов"))

model, voices, out_dir, bank = sys.argv[1:5]
only = set(sys.argv[5:])
k = Kokoro(model, voices)

# основной и запасной голос (если в диалоге два говорящих одного пола и акцента)
VOICES = {
    ("female", "British"): ["bf_emma", "bf_isabella"],
    ("male", "British"): ["bm_fable", "bm_lewis"],  # выбран на слух (bm_george не подошёл)
    ("female", "American"): ["af_heart", "af_sarah"],
    ("male", "American"): ["am_michael", "am_adam"],
}
SPEED = {"A1": 0.8, "A2": 0.86, "B1": 0.93, "B2": 0.98, "C1": 1.02}
SENT_GAP = {"A1": 0.45, "A2": 0.32, "B1": 0.22, "B2": 0.15, "C1": 0.1}  # пауза между предложениями
VOICE_SPEED = {"bf_emma": 0.88}  # этот голос говорит заметно быстрее остальных — выравниваем темп
TURN_GAP = {"A1": 0.55, "A2": 0.45, "B1": 0.4, "B2": 0.35, "C1": 0.3}


PAUSE_STRETCH = os.environ.get("PAUSE_STRETCH", "1") == "1"
COMMA_PAUSE = {"A1": 0.28, "A2": 0.24, "B1": 0.2, "B2": 0.17, "C1": 0.14}   # добавка к паузе на запятой, с
STOP_PAUSE = {"A1": 0.4, "A2": 0.34, "B1": 0.28, "B2": 0.24, "C1": 0.2}    # … на точке / ? / ! внутри реплики


def stretch_pauses(audio, sr, text, level):
    """Фраза озвучена целиком (интонация не обрывается); на запятых и точках модель оставляет лишь
    короткий провал громкости. Для каждого знака ищем провал рядом с тем местом, где знак примерно
    звучит (по доле текста), и удлиняем его. Нет подходящего провала — паузу не трогаем."""
    marks = [(m.end() / max(1, len(text)), m.group(0)) for m in re.finditer(r"[,;:—]|[.!?]+(?=\s+\S)", text)]
    if not marks:
        return audio
    hop = int(sr * 0.01)
    frames = len(audio) // hop
    dur = frames * 0.01
    rms = np.array([np.sqrt(np.mean(audio[i * hop:(i + 1) * hop] ** 2)) for i in range(frames)])
    thr = max(0.015, 0.06 * float(np.percentile(rms, 95)))
    gaps, i = [], 0
    while i < frames:
        if rms[i] < thr:
            j = i
            while j < frames and rms[j] < thr:
                j += 1
            if i > 5 and j < frames - 5 and j - i >= 6:  # тихий участок ≥ 60 мс внутри речи
                gaps.append(((i + j) // 2, j - i))
            i = j
        else:
            i += 1
    used, cuts = set(), []
    for frac, mark in marks:
        want = frac * dur
        best = None
        for c, n in gaps:
            dist = abs(c * 0.01 - want)
            if c in used or dist > max(0.45, 0.12 * dur):
                continue
            score = dist - n * 0.004  # ближе к ожидаемому месту и длиннее — лучше
            if best is None or score < best[0]:
                best = (score, c)
        if best:
            used.add(best[1])
            cuts.append((best[1], mark))
    out, prev = [], 0
    for c, mark in sorted(cuts):
        cut = c * hop
        out += [audio[prev:cut], np.zeros(int(sr * (COMMA_PAUSE if mark in ",;:—" else STOP_PAUSE)[level]), dtype=np.float32)]
        prev = cut
    out.append(audio[prev:])
    return np.concatenate(out)


def silence(sec, sr):
    return np.zeros(int(sec * sr), dtype=np.float32)


WHOLE_TURN = os.environ.get("WHOLE_TURN") == "1"
SPEED_SCALE = float(os.environ.get("SPEED_SCALE", "1"))
OVERRIDE = dict(x.split("=") for x in os.environ.get("VOICE_OVERRIDE", "").split(",") if "=" in x)
SUFFIX = os.environ.get("OUT_SUFFIX", "")


def voice_map(item):
    used, res = {}, {}
    for s in item["speakers"]:
        key = (s["gender"], s["accent"])
        n = used.get(key, 0)
        res[s["name"]] = VOICES[key][min(n, len(VOICES[key]) - 1)]
        used[key] = n + 1
    res.update({k_: v for k_, v in OVERRIDE.items() if k_ in res})
    return res


def render(item):
    vm = voice_map(item)
    lang = {"British": "en-gb", "American": "en-us"}
    accent = {s["name"]: s["accent"] for s in item["speakers"]}
    speed, gap = SPEED[item["level"]], TURN_GAP[item["level"]]
    sr, parts = 24000, [silence(0.4, 24000)]
    for line in item["script"].split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^([A-Za-z][\w ]*?):\s*(.*)$", line)
        name, text = (m.group(1), m.group(2)) if m and m.group(1) in vm else (item["speakers"][0]["name"], line)
        for chunk in re.split(r"(\[pause [\d.]+s\])", text):
            p = re.match(r"\[pause ([\d.]+)s\]", chunk)
            if p:
                parts.append(silence(float(p.group(1)), sr))
                continue
            chunk = chunk.strip()
            if not chunk:
                continue
            for sent in ([chunk] if WHOLE_TURN else re.split(r"(?<=[.!?])\s+", chunk)):
                if not sent.strip():
                    continue
                audio, sr = k.create(sent, voice=vm[name], speed=speed * SPEED_SCALE * VOICE_SPEED.get(vm[name], 1.0), lang=lang[accent[name]])
                audio = audio.astype(np.float32)
                if PAUSE_STRETCH:
                    audio = stretch_pauses(audio, sr, sent, item["level"])
                parts.append(audio)
                parts.append(silence(SENT_GAP[item["level"]], sr))
        parts.append(silence(gap, sr))
    parts.append(silence(0.5, sr))
    audio = np.concatenate(parts)
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = audio / peak * 0.89  # единая громкость всех записей
    wav = os.path.join(out_dir, item["id"] + SUFFIX + ".wav")
    mp3 = os.path.join(out_dir, item["id"] + SUFFIX + ".mp3")
    sf.write(wav, audio, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "64k", mp3], check=True)
    os.remove(wav)
    return len(audio) / sr, vm


for item in json.load(open(bank)):
    if only and item["id"] not in only:
        continue
    dur, vm = render(item)
    print(f"{item['id']}: {dur:.1f} с (ожидалось ≈{item.get('duration_sec')} с) — " + ", ".join(f"{n} → {v}" for n, v in vm.items()), flush=True)
