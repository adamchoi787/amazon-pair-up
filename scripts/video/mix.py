"""Mix voice, music and sound effects into the master track (video/build/mix.wav).

The music ducks under every spoken line, with an extra cut in the speech band
(1-4 kHz) so words stay clear over the brass. The master is normalised to
-14 LUFS with true peaks below -1 dBTP.
"""
import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pedalboard import Pedalboard, Compressor, HighpassFilter, LowpassFilter, PeakFilter, HighShelfFilter, Reverb, Limiter, Distortion, Gain
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
TL = json.loads((ROOT / "scripts/video/timeline.json").read_text(encoding="utf-8"))
VO = json.loads((ROOT / "scripts/video/studio/src/generated/vo.json").read_text(encoding="utf-8"))
B = ROOT / "video/build"
SR = 48000

# Bus levels and how far each bus ducks under speech (dB).
BUS = {"drums": (-3.0, 8.0), "low": (-2.0, 6.0), "mid": (-2.5, 12.0), "sfx": (-3.0, 6.0)}
SPEECH_BAND_CUT = 7.0
VOICE_DB = {"narrator": 0.0, "sam": 0.5, "mei": 0.5, "tony": 0.5, "pairup": 0.5}


def board(*p):
    return Pedalboard(list(p))


NARRATOR = board(HighpassFilter(85), PeakFilter(250, -2.0, 1.0), PeakFilter(3200, 2.5, 0.8), HighShelfFilter(9000, 1.5),
                 Compressor(threshold_db=-22, ratio=3.0, attack_ms=4, release_ms=80), Gain(4))
PHONE = board(HighpassFilter(220), LowpassFilter(7500), PeakFilter(1800, 3.0, 0.9), Distortion(drive_db=4),
              Compressor(threshold_db=-22, ratio=3, attack_ms=4, release_ms=80), Reverb(room_size=0.15, wet_level=0.08), Gain(3))
ASSISTANT = board(HighpassFilter(120), PeakFilter(2800, 2.0, 0.8), Compressor(threshold_db=-22, ratio=3, attack_ms=4, release_ms=80),
                  Reverb(room_size=0.35, wet_level=0.14), Gain(3))


def proc(x: np.ndarray, p: Pedalboard) -> np.ndarray:
    return p(x[None, :].astype(np.float32), SR)[0]


def activity(n: int, spans, attack=0.08, release=0.45):
    """0..1 curve that rises before each span and falls after it."""
    a = np.zeros(n, np.float32)
    for s, e in spans:
        a[int((s - attack) * SR):int((e + 0.05) * SR)] = 1
    # Smooth: fast rise, slow fall.
    out = np.zeros_like(a)
    up, down = 1 - np.exp(-1 / (0.03 * SR)), 1 - np.exp(-1 / (release * SR))
    v = 0.0
    for i in range(0, n, 64):
        target = a[i]
        v += (target - v) * (1 - (1 - (up if target > v else down)) ** 64)
        out[i:i + 64] = v
    return out


def band(x, lo, hi):
    sos = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x, axis=0).astype(np.float32)


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def tp_limit(x: np.ndarray, ceiling_db=-1.3, look=0.004, release=0.12) -> np.ndarray:
    """Look-ahead limiter on 4x-oversampled peaks, so true peaks stay under the ceiling."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    ceil = 10 ** (ceiling_db / 20)
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(axis=1)
    peak = up[: len(up) // 4 * 4].reshape(-1, 4).max(axis=1)
    peak = np.pad(peak, (0, len(x) - len(peak)), mode="edge")
    gr = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    la = max(1, int(look * SR))
    gr = minimum_filter1d(gr, size=2 * la + 1, origin=0)
    # Release: recover upward slowly, evaluated per block of 32 samples.
    blk = 32
    m = gr[: len(gr) // blk * blk].reshape(-1, blk).min(axis=1)
    coef = np.exp(-blk / (release * SR))
    out = np.empty_like(m)
    v = 1.0
    for i, g in enumerate(m):
        v = g if g < v else g + (v - g) * coef
        out[i] = v
    env = np.repeat(out, blk)
    env = np.pad(env, (0, len(gr) - len(env)), mode="edge")
    env = np.minimum(env, gr)
    env = uniform_filter1d(env, size=la)
    env = np.minimum(env, minimum_filter1d(gr, size=la))
    return x * env[:, None]


def main():
    stems = {k: sf.read(B / f"music/{k}.wav", dtype="float32")[0] for k in BUS}
    n = max(len(v) for v in stems.values())
    voice = np.zeros(n, np.float32)
    spans = []
    for line in VO:
        x, sr = sf.read(B / f"vo/{line['id']}.wav", dtype="float32")
        who = line["who"]
        p = NARRATOR if who == "narrator" else ASSISTANT if who == "pairup" else PHONE
        x = proc(x, p) * 10 ** (VOICE_DB[who] / 20)
        i = int(line["start"] * SR)
        voice[i:i + len(x)] += x[: n - i]
        spans.append((line["start"], line["start"] + line["duration"]))
    act = activity(n, spans)[:, None]
    music = np.zeros((n, 2), np.float32)
    for k, (gain, duck) in BUS.items():
        x = stems[k][:n] * 10 ** (gain / 20)
        if k == "mid":
            sb = band(x, 1000, 4500)
            x = x - sb * (1 - 10 ** (-SPEECH_BAND_CUT / 20) * np.ones(1)) * act
        music += x * 10 ** (-duck * act / 20)
    glue = board(Compressor(threshold_db=-16, ratio=2.0, attack_ms=20, release_ms=200))
    music = glue(music.T.copy(), SR).T
    mixed = music + np.stack([voice, voice], 1) * 0.92
    # Master: gain into a true-peak limiter, searched until it lands at -14 LUFS.
    meter = pyln.Meter(SR)
    g = 1.0
    for _ in range(6):
        y = tp_limit(mixed * g)
        lufs = meter.integrated_loudness(y)
        if abs(lufs + 14.0) < 0.05:
            break
        g *= 10 ** ((-14.0 - lufs) / 20)
    print(f"master gain {20 * np.log10(g):.1f} dB")
    y = np.clip(y, -0.99, 0.99)
    end = int((TL["bars"] * 60 / TL["bpm"] * TL["beatsPerBar"] + TL["tailSeconds"]) * SR)
    y = y[:end]
    fade = int(0.8 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    sf.write(B / "mix.wav", y, SR, subtype="PCM_24")
    sf.write(B / "voice.wav", voice[:end], SR, subtype="PCM_24")
    sf.write(B / "music_only.wav", music[:end], SR, subtype="PCM_24")
    print(f"mix: {len(y) / SR:.2f}s  integrated {meter.integrated_loudness(y):.2f} LUFS  true peak {true_peak(y):.2f} dBTP")


if __name__ == "__main__":
    main()
