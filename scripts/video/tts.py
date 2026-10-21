"""Synthesize the narration and character lines in timeline.json.

Writes video/build/vo/<id>.wav (48 kHz mono, trimmed) and
scripts/video/studio/src/generated/vo.json with each line's start, duration and
word timings in seconds from the start of the film. Fails when a line runs past
its window, so the cut never has to squeeze a sentence.
"""
import asyncio, json, re, subprocess, sys
from pathlib import Path

import edge_tts
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
TL = json.loads((ROOT / "scripts/video/timeline.json").read_text(encoding="utf-8"))
OUT = ROOT / "video/build/vo"
GEN = ROOT / "scripts/video/studio/src/generated"
SR = 48000
BAR = 60 / TL["bpm"] * TL["beatsPerBar"]

# Spoken forms for words the voices would otherwise spell out or misread.
SAY = [
    (r"Alexa\+", "Alexa Plus"),
    (r"\bTI-84\b", "T.I. eighty-four"),
    (r"\bHUB\b", "hub"),
    (r"\bMCP\b", "M, C, P"),
    (r"PairUp", "Pair Up"),
    (r"\bAWS\b", "A.W.S."),
    (r"\bUW\b", "U.W."),
]


def spoken(text: str) -> str:
    for pat, rep in SAY:
        text = re.sub(pat, rep, text)
    return text


async def synth(line, voice, mp3: Path):
    c = edge_tts.Communicate(spoken(line["text"]), voice["voice"], rate=voice["rate"], pitch=voice["pitch"], boundary="WordBoundary")
    words = []
    with mp3.open("wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "w": ch["text"]})
    return words


def decode(mp3: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def trim(x: np.ndarray):
    """Cut leading and trailing silence; return audio and the seconds removed at the start."""
    env = np.convolve(np.abs(x), np.ones(480) / 480, mode="same")
    on = np.where(env > 0.004)[0]
    a = max(0, on[0] - int(0.02 * SR))
    b = min(len(x), on[-1] + int(0.08 * SR))
    y = x[a:b].copy()
    fade = int(0.006 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y, a / SR


def caption_words(display: str, words, lead: float, start: float, dur: float):
    """Map spoken word timings onto the display words (one to one when counts match)."""
    shown = display.split()
    spoken_ts = [(w["t"] - lead, w["d"]) for w in words]
    if len(spoken_ts) == len(shown):
        return [{"w": s, "t": round(start + max(0, t), 3), "d": round(d, 3)} for s, (t, d) in zip(shown, spoken_ts)]
    # Fall back to spreading display words by character count over the spoken span.
    total = sum(len(s) + 1 for s in shown)
    out, acc = [], 0.0
    for s in shown:
        frac = (len(s) + 1) / total
        out.append({"w": s, "t": round(start + acc * dur, 3), "d": round(frac * dur, 3)})
        acc += frac
    return out


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    GEN.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    result, problems = [], []
    for line in TL["lines"]:
        voice = TL["voices"][line["who"]]
        mp3 = OUT / f"{line['id']}.mp3"
        if not only or line["id"] in only or not mp3.exists():
            for attempt in range(4):
                try:
                    words = await synth(line, voice, mp3)
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(2 + attempt * 3)
            (OUT / f"{line['id']}.words.json").write_text(json.dumps(words), encoding="utf-8")
        words = json.loads((OUT / f"{line['id']}.words.json").read_text(encoding="utf-8"))
        audio, lead = trim(decode(mp3))
        sf.write(OUT / f"{line['id']}.wav", audio, SR, subtype="FLOAT")
        start = line["at"] * BAR
        dur = len(audio) / SR
        window = (line["until"] - line["at"]) * BAR
        if dur > window:
            problems.append(f"{line['id']}: {dur:.2f}s > window {window:.2f}s ({line['text']})")
        result.append({
            "id": line["id"], "who": line["who"], "text": line["text"],
            "start": round(start, 3), "duration": round(dur, 3), "window": round(window, 3),
            "words": caption_words(line["text"], words, lead, start, dur),
        })
        print(f"{line['id']:6} {dur:5.2f}s / {window:5.2f}s  {'OVER' if dur > window else 'ok'}")
    (GEN / "vo.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    if problems:
        print("\nLines over their window:\n" + "\n".join(problems))
        sys.exit(1)


asyncio.run(main())
