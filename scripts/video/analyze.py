"""Objective checks on the soundtrack: spectrogram sheet, loudness per scene, speech clarity.

analyze.py            -> video/build/analysis.png and a loudness table
analyze.py --whisper  -> also transcribes the full mix and scores each line's words
"""
import json, re, sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
TL = json.loads((ROOT / "scripts/video/timeline.json").read_text(encoding="utf-8"))
VO = json.loads((ROOT / "scripts/video/studio/src/generated/vo.json").read_text(encoding="utf-8"))
B = ROOT / "video/build"
BAR = 60 / TL["bpm"] * TL["beatsPerBar"]


def short_lufs(x, sr, win=0.4):
    n = int(win * sr)
    out = []
    for i in range(0, len(x) - n, n):
        seg = x[i:i + n]
        ms = np.mean(seg ** 2)
        out.append(10 * np.log10(ms + 1e-12))
    return np.array(out)


def main():
    mix, sr = sf.read(B / "mix.wav", dtype="float32")
    music, _ = sf.read(B / "music_only.wav", dtype="float32")
    voice, _ = sf.read(B / "voice.wav", dtype="float32")
    meter = pyln.Meter(sr)
    print(f"{'scene':10} {'mix LUFS':>9} {'music':>7} {'voice':>7}  speech-to-music (during lines)")
    for s in TL["scenes"]:
        a, b = int(s["start"] * BAR * sr), int((s["start"] + s["bars"]) * BAR * sr)
        m = meter.integrated_loudness(mix[a:b]) if b - a > sr else float("nan")
        mu = meter.integrated_loudness(music[a:b])
        v = meter.integrated_loudness(np.stack([voice[a:b]] * 2, 1)) if np.abs(voice[a:b]).max() > 0 else float("-inf")
        # Speech-to-music ratio while lines play, in the 1-4.5 kHz band where words live.
        sos = signal.butter(2, [1000, 4500], "bandpass", fs=sr, output="sos")
        ratios = []
        for line in VO:
            if s["start"] * BAR <= line["start"] < (s["start"] + s["bars"]) * BAR:
                i, j = int(line["start"] * sr), int((line["start"] + line["duration"]) * sr)
                vb = signal.sosfilt(sos, voice[i:j])
                mb = signal.sosfilt(sos, music[i:j].mean(axis=1) * 0.92 ** 0)
                ratios.append(10 * np.log10(np.mean(vb ** 2) / (np.mean(mb ** 2) + 1e-12)))
        r = f"{np.mean(ratios):5.1f} dB (min {np.min(ratios):5.1f})" if ratios else ""
        print(f"{s['id']:10} {m:9.1f} {mu:7.1f} {v:7.1f}  {r}")

    # Spectrogram sheet: 6 rows of ~30 s with bar lines and scene names.
    mono = mix.mean(axis=1)
    rows = 6
    span = len(mono) / sr / rows
    fig, axes = plt.subplots(rows, 1, figsize=(22, 3.0 * rows))
    for r, ax in enumerate(axes):
        a, b = int(r * span * sr), int((r + 1) * span * sr)
        f, t, S = signal.spectrogram(mono[a:b], sr, nperseg=2048, noverlap=1536)
        ax.pcolormesh(t + r * span, f, 10 * np.log10(S + 1e-12), shading="auto", vmin=-110, vmax=-30, cmap="magma")
        ax.set_yscale("symlog", linthresh=200)
        ax.set_ylim(30, 16000)
        for bar in range(TL["bars"] + 1):
            x = bar * BAR
            if r * span <= x <= (r + 1) * span:
                ax.axvline(x, color="white", lw=0.3 if bar % 4 else 0.9, alpha=0.5)
        for s in TL["scenes"]:
            x = s["start"] * BAR
            if r * span <= x <= (r + 1) * span:
                ax.text(x + 0.1, 12000, s["id"], color="cyan", fontsize=11)
        for line in VO:
            if r * span <= line["start"] <= (r + 1) * span:
                ax.add_patch(plt.Rectangle((line["start"], 35), line["duration"], 12, color="lime", alpha=0.6))
        env = short_lufs(mono[a:b], sr, 0.1)
        ax2 = ax.twinx()
        ax2.plot(np.arange(len(env)) * 0.1 + r * span, env, color="white", lw=0.8)
        ax2.set_ylim(-60, 0)
        ax.set_xlim(r * span, (r + 1) * span)
    plt.tight_layout()
    plt.savefig(B / "analysis.png", dpi=55)
    print("wrote", B / "analysis.png")

    if "--whisper" in sys.argv:
        from faster_whisper import WhisperModel
        model = WhisperModel("small.en", device="cpu", compute_type="int8")
        segs, _ = model.transcribe(str(B / "mix.wav"), beam_size=5, word_timestamps=True)
        heard = [(w.start, w.word.strip().lower()) for s in segs for w in s.words]
        tot, hit = 0, 0
        for line in VO:
            want = [re.sub(r"[^a-z0-9]", "", w.lower()) for w in line["text"].split()]
            got = "".join(re.sub(r"[^a-z0-9]", "", w) for t, w in heard if line["start"] - 0.4 <= t <= line["start"] + line["duration"] + 0.4)
            ok = sum(1 for w in want if w and w in got)
            if "-v" in sys.argv:
                print("   heard:", got)
            tot += len(want)
            hit += ok
            flag = "" if ok >= 0.8 * len(want) else "  <-- check"
            print(f"{line['id']:6} {ok:2}/{len(want):2}{flag}")
        print(f"words recovered from the full mix: {hit}/{tot} ({100 * hit / tot:.0f}%)")


if __name__ == "__main__":
    main()
