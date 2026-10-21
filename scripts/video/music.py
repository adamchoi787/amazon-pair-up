"""Original arrangement of Offenbach's Galop infernal (the can-can) plus sound design.

Writes stems to video/build/music/: drums.wav, low.wav, mid.wav (melody, chords,
pads) and sfx.wav. The arrangement follows the bars in timeline.json; the sound
effects follow its cue sheet. Orchestral parts use GeneralUser GS (free license)
through tinysoundfont; drums, synths and effects are synthesized here.
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import tinysoundfont
from pedalboard import Pedalboard, Reverb, Compressor, HighpassFilter, LowpassFilter, Chorus, Delay, Distortion, Gain
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
TL = json.loads((ROOT / "scripts/video/timeline.json").read_text(encoding="utf-8"))
OUT = ROOT / "video/build/music"
SF2 = str(ROOT / "video/build/sf/GeneralUser-GS.sf2")
SR = 48000
BEAT = 60 / TL["bpm"]
BAR = BEAT * TL["beatsPerBar"]
S16 = BEAT / 4
LENGTH = TL["bars"] * BAR + TL["tailSeconds"] + 1.0
N = int(LENGTH * SR)
rng = np.random.default_rng(1858)  # the year of Orphée aux enfers


def T(bar: float) -> float:
    return bar * BAR


def ns(sec: float) -> int:
    return int(round(sec * SR))


def stereo() -> np.ndarray:
    return np.zeros((N, 2), np.float32)


def place(bus: np.ndarray, x: np.ndarray, at: float, gain_db: float = 0.0, pan: float = 0.0):
    """Add mono or stereo x into bus at `at` seconds, with constant-power pan (-1..1)."""
    g = 10 ** (gain_db / 20)
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)
    i = ns(at)
    if i >= N or i + len(x) <= 0:
        return
    if i < 0:
        x, i = x[-i:], 0
    j = min(N, i + len(x))
    bus[i:j] += x[: j - i] * g


def env_exp(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / SR / tau)


def noise(sec: float) -> np.ndarray:
    return rng.standard_normal(ns(sec)).astype(np.float32)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x).astype(np.float32)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "highpass", fs=SR, output="sos"), x).astype(np.float32)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "lowpass", fs=SR, output="sos"), x).astype(np.float32)


def fx(x: np.ndarray, *plugins) -> np.ndarray:
    """Run a mono or stereo buffer through pedalboard plugins."""
    board = Pedalboard(list(plugins))
    y = board(x.T.copy() if x.ndim == 2 else x[None, :].copy(), SR)
    return y.T.astype(np.float32) if x.ndim == 2 else y[0].astype(np.float32)


def norm(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


# --------------------------------------------------------------------------- score
MAJOR = [0, 2, 4, 5, 7, 9, 11]
HARM_MINOR = [0, 2, 3, 5, 7, 8, 11]

# The can-can theme, from the score. (degree, octave, sixteenths); degree 0 = rest.
A1 = [(1, 0, 4), (2, 0, 1), (4, 0, 1), (3, 0, 1), (2, 0, 1), (5, 0, 2), (5, 0, 2), (5, 0, 1), (6, 0, 1), (3, 0, 1), (4, 0, 1),
      (2, 0, 2), (2, 0, 2), (2, 0, 1), (4, 0, 1), (3, 0, 1), (2, 0, 1), (1, 0, 1), (1, 1, 1), (7, 0, 1), (6, 0, 1),
      (5, 0, 1), (4, 0, 1), (3, 0, 1), (2, 0, 1)]
A2 = A1[:17] + [(1, 0, 1), (5, 0, 1), (2, 0, 1), (3, 0, 1), (1, 0, 2), (0, 0, 2)]
THEME = A1 + A2  # 64 sixteenths = 16 theme beats

# Harmony per theme beat (16 beats for A1 + A2).
PROG = ["I", "V7", "I", "I", "V7", "V7", "I", "V7", "I", "V7", "I", "I", "V7", "V7", "I", "I"]
CHORD = {"I": [0, 4, 7], "i": [0, 3, 7], "V7": [7, 11, 14, 17], "IV": [5, 9, 12], "vi": [9, 12, 16]}
ROOT_OF = {"I": 0, "i": 0, "V7": -5, "IV": 5, "vi": -3}

D = 62  # tonic: D4


def pitch(deg: int, octv: int, tonic: int, scale) -> int:
    return tonic + scale[deg - 1] + 12 * octv


def melody(start: float, unit: float, tonic: int, scale=MAJOR, phrase=THEME, art=0.82, vel=100, accent=12):
    """Events (start, dur, key, vel) for a phrase; unit = seconds per sixteenth."""
    ev, pos = [], 0
    for deg, octv, u in phrase:
        if deg:
            on_beat = pos % 4 == 0
            ev.append((start + pos * unit, u * unit * (art if u < 3 else 0.95), pitch(deg, octv, tonic, scale),
                       min(127, vel + (accent if on_beat else 0) + int(rng.integers(-4, 5)))))
        pos += u
    return ev


def chord_keys(name: str, tonic: int, minor=False):
    tones = CHORD["i" if (minor and name == "I") else name]
    return [tonic + t for t in tones]


# --------------------------------------------------------------------------- SF2 rendering
# Stop-time breaks: (start, end) seconds where the band rests so a line can land.
BREAKS: list[tuple[float, float]] = []


def broken(t: float) -> bool:
    return any(a - 1e-6 <= t < b - 1e-6 for a, b in BREAKS)


class Orchestra:
    """Renders note events for General MIDI programs from GeneralUser GS."""

    def __init__(self):
        self.parts: dict[str, list] = {}

    def add(self, name: str, program: int, events, gain_db=0.0, pan=0.0, force=False):
        events = [e for e in events if force or not broken(e[0])]
        self.parts.setdefault(name, {"program": program, "events": [], "gain": gain_db, "pan": pan})["events"].extend(events)

    def render(self, name: str) -> np.ndarray:
        part = self.parts[name]
        syn = tinysoundfont.Synth(samplerate=SR)
        sfid = syn.sfload(SF2)
        syn.program_select(0, sfid, 0, part["program"])
        evs = []
        for (s, d, k, v) in part["events"]:
            jitter = rng.normal(0, 0.002)
            evs.append((max(0, ns(s + jitter)), 1, int(k), int(v)))
            evs.append((max(0, ns(s + jitter + d)), 0, int(k), 0))
        evs.sort(key=lambda e: (e[0], e[1]))
        out = np.zeros((N, 2), np.float32)
        pos = 0
        for (i, on, k, v) in evs + [(N, -1, 0, 0)]:
            i = min(i, N)
            if i > pos:
                out[pos:i] = np.frombuffer(syn.generate(i - pos), np.float32).reshape(-1, 2)
                pos = i
            if on == 1:
                syn.noteon(0, k, v)
            elif on == 0:
                syn.noteoff(0, k)
        a = (part["pan"] + 1) * np.pi / 4
        out[:, 0] *= np.cos(a) * np.sqrt(2)
        out[:, 1] *= np.sin(a) * np.sqrt(2)
        return out * 10 ** (part["gain"] / 20)


# --------------------------------------------------------------------------- drums
def kick(hard=1.0):
    n = ns(0.5)
    t = np.arange(n) / SR
    f = 46 + (170 - 46) * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.26 + 0.08 * hard))
    click = hp(noise(0.5), 2500) * np.exp(-t / 0.0025) * 0.35
    return np.tanh((1.4 + 0.6 * hard) * (body + click)).astype(np.float32) * 0.9


def snare():
    n = ns(0.45)
    t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * 186 * t) + 0.45 * np.sin(2 * np.pi * 334 * t)) * np.exp(-t / 0.07)
    nz = bp(noise(0.45), 1400, 9500) * np.exp(-t / 0.15)
    return np.tanh(1.3 * (0.6 * tone + 0.9 * nz)).astype(np.float32) * 0.8


def clap():
    n = ns(0.5)
    t = np.arange(n) / SR
    x = np.zeros(n, np.float32)
    src = bp(noise(0.5), 900, 3200)
    for k, off in enumerate([0, 0.010, 0.021, 0.034]):
        e = np.where(t >= off, np.exp(-(t - off) / (0.006 if k < 3 else 0.17)), 0)
        x += src * e
    return np.tanh(1.6 * x).astype(np.float32) * 0.7


def metal(sec, decay):
    """808-style metallic source: six square waves at inharmonic ratios."""
    n = ns(sec)
    t = np.arange(n) / SR
    x = sum(np.sign(np.sin(2 * np.pi * f * 1.7 * t)) for f in [205.3, 304.4, 369.6, 522.7, 540.0, 800.0])
    return bp(x.astype(np.float32), 7000, 15000) * np.exp(-t / decay)


def hat(open_=False):
    sec = 0.6 if open_ else 0.12
    dec = 0.22 if open_ else 0.028
    t = np.arange(ns(sec)) / SR
    x = 0.6 * metal(sec, dec) + 0.5 * hp(noise(sec), 8000) * np.exp(-t / dec)
    return x.astype(np.float32) * 0.5


def shaker():
    t = np.arange(ns(0.12)) / SR
    e = np.minimum(t / 0.012, 1) * np.exp(-t / 0.045)
    return (bp(noise(0.12), 4500, 12000) * e).astype(np.float32) * 0.5


def crash(sec=3.2):
    t = np.arange(ns(sec)) / SR
    x = 0.5 * metal(sec, 1.1) + 0.8 * hp(noise(sec), 3500) * np.exp(-t / 0.9)
    x = x * np.minimum(t / 0.002, 1)
    return fx(x.astype(np.float32), Reverb(room_size=0.5, wet_level=0.25, dry_level=0.9)) * 0.55


# --------------------------------------------------------------------------- synths
def osc_saw(freq, n, detune=0.0):
    t = np.arange(n) / SR
    ph = (freq * (1 + detune) * t) % 1.0
    return 2 * ph - 1


def sub_note(freq, sec, tau=0.35):
    t = np.arange(ns(sec)) / SR
    e = np.minimum(t / 0.004, 1) * np.exp(-t / tau)
    return (np.sin(2 * np.pi * freq * t) * e).astype(np.float32)


def reese(freq, sec, cutoff=900):
    n = ns(sec)
    t = np.arange(n) / SR
    x = osc_saw(freq, n, -0.004) + osc_saw(freq, n, 0.004) + 0.8 * np.sin(2 * np.pi * freq * t)
    e = np.minimum(t / 0.004, 1) * np.exp(-t / 0.5)
    return lp((x * e).astype(np.float32), cutoff, 4)


def pluck_synth(freq, sec, cutoff=2400):
    n = ns(sec)
    t = np.arange(n) / SR
    x = osc_saw(freq, n, -0.003) + osc_saw(freq, n, 0.003) + 0.5 * osc_saw(freq * 2, n)
    e = np.minimum(t / 0.002, 1) * np.exp(-t / 0.16)
    y = lp((x * e).astype(np.float32), cutoff, 2)
    return y * 0.35


def midi_hz(k):
    return 440 * 2 ** ((k - 69) / 12)


# --------------------------------------------------------------------------- effects
def stft_sweep(sec, f0, f1, width=0.35, curve=2.0, amp=None):
    """Noise through a band that sweeps from f0 to f1 (log), via STFT masking."""
    x = noise(sec)
    f, tt, Z = signal.stft(x, SR, nperseg=1024)
    prog = (tt / tt[-1]) ** curve if tt[-1] > 0 else tt
    centers = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * prog)
    lf = np.log(np.maximum(f, 1))[:, None]
    mask = np.exp(-((lf - np.log(centers)[None, :]) ** 2) / (2 * width ** 2))
    _, y = signal.istft(Z * mask, SR, nperseg=1024)
    y = y[: len(x)].astype(np.float32)
    if amp is not None:
        y *= amp(np.arange(len(y)) / SR)
    return norm(y, 0.8)


def riser(sec):
    t = np.arange(ns(sec)) / SR
    a = lambda tt: (tt / sec) ** 2.2
    nz = stft_sweep(sec, 250, 9000, 0.5, 1.6, a)
    f = 180 * (8 ** (t / sec) ** 1.5)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / sec) ** 2 * 0.25
    return fx((nz + tone).astype(np.float32), Reverb(room_size=0.7, wet_level=0.3)) * 0.8


def reverse_cymbal(sec=1.6):
    c = crash(sec + 0.5)
    return c[::-1][-ns(sec):].copy()


def whoosh(sec=0.55, up=True):
    a = lambda tt: np.sin(np.pi * np.clip(tt / sec, 0, 1)) ** 1.5
    x = stft_sweep(sec, 300 if up else 6000, 6000 if up else 300, 0.6, 1.0, a)
    pan = np.linspace(-0.8, 0.8, len(x))
    ang = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(ang), x * np.sin(ang)], 1).astype(np.float32) * 1.2


def swoosh():
    return whoosh(0.32) * 0.8


def impact():
    t = np.arange(ns(2.4)) / SR
    f = 32 + 60 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    hit = lp(noise(2.4), 2500) * np.exp(-t / 0.09) * 0.7
    x = np.tanh(1.5 * (boom + hit)).astype(np.float32)
    return fx(x, Reverb(room_size=0.85, wet_level=0.35, dry_level=0.8)) * 0.9


def stamp():
    t = np.arange(ns(0.4)) / SR
    f = 50 + 90 * np.exp(-t / 0.02)
    th = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.08)
    cl = bp(noise(0.4), 1500, 6000) * np.exp(-t / 0.006) * 0.6
    return fx(np.tanh(2 * (th + cl)).astype(np.float32), Reverb(room_size=0.25, wet_level=0.15)) * 0.8


def pop():
    t = np.arange(ns(0.12)) / SR
    f = 500 + 900 * (1 - np.exp(-t / 0.02))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)
    return (x + 0.2 * bp(noise(0.12), 2000, 7000) * np.exp(-t / 0.004)).astype(np.float32) * 0.6


def blip(freq=1320):
    t = np.arange(ns(0.18)) / SR
    x = (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)) * np.exp(-t / 0.05)
    return x.astype(np.float32) * 0.45


def tick(freq=2400):
    t = np.arange(ns(0.06)) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.008) + bp(noise(0.06), 2000, 8000) * np.exp(-t / 0.002) * 0.4
    return x.astype(np.float32) * 0.5


def click():
    return tick(3200) * 0.8


def flip():
    x = np.zeros(ns(0.2), np.float32)
    x[: ns(0.06)] += tick(1800)
    k = ns(0.05)
    x[k:k + ns(0.06)] += tick(1400)
    t = np.arange(ns(0.2)) / SR
    x += lp(noise(0.2), 1800) * np.exp(-t / 0.03) * 0.25
    return x


def lock():
    x = np.zeros(ns(0.25), np.float32)
    for off, f in [(0, 2600), (0.045, 3400)]:
        k = ns(off)
        y = tick(f) + bp(noise(0.06), 3000, 9000) * env_exp(ns(0.06), 0.004) * 0.5
        x[k:k + len(y)] += y
    t = np.arange(len(x)) / SR
    x += np.sin(2 * np.pi * 120 * t) * np.exp(-t / 0.03) * 0.4
    return x


def bell(freq, sec=2.0, bright=1.0):
    t = np.arange(ns(sec)) / SR
    parts = [(1, 1.0, 1.4), (2.0, 0.5 * bright, 0.7), (3.01, 0.25 * bright, 0.45), (4.17, 0.14 * bright, 0.3), (5.43, 0.08 * bright, 0.2)]
    x = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / d) for r, a, d in parts)
    return (x * np.minimum(t / 0.002, 1)).astype(np.float32)


def dingdong():
    """Two-tone doorbell tuned to the key: F#5 then D5."""
    x = np.zeros(ns(1.9), np.float32)
    a, b = bell(midi_hz(78), 1.2), bell(midi_hz(74), 1.4)
    x[: len(a)] += a
    k = ns(0.42)
    x[k:k + len(b)] += b[: len(x) - k]
    return fx(x, Reverb(room_size=0.6, wet_level=0.3)) * 0.35


def chime():
    x = np.zeros(ns(2.0), np.float32)
    for i, k in enumerate([74, 78, 81, 86]):
        b = bell(midi_hz(k), 1.6, 0.7)
        o = ns(i * 0.07)
        x[o:o + len(b)] += b[: len(x) - o] * (0.8 - i * 0.1)
    return fx(x, Reverb(room_size=0.7, wet_level=0.35)) * 0.3


def shimmer():
    x = np.zeros(ns(1.8), np.float32)
    for i in range(14):
        b = bell(midi_hz(86 + [0, 4, 7, 12, 16, 19, 24][i % 7]), 0.9, 0.5) * 0.25
        o = ns(i * 0.045)
        x[o:o + len(b)] += b[: len(x) - o]
    return fx(x, Reverb(room_size=0.8, wet_level=0.45)) * 0.5


def cash():
    """Register sparkle: a 'cha' of noise, a two-bell 'ching' and glitter."""
    x = np.zeros(ns(1.6), np.float32)
    t = np.arange(ns(0.12)) / SR
    x[: len(t)] += bp(noise(0.12), 2500, 9000) * np.exp(-t / 0.03) * 0.7
    for off, k in [(0.06, 96), (0.06, 100), (0.11, 103)]:
        b = bell(midi_hz(k), 1.2, 0.6) * 0.35
        o = ns(off)
        x[o:o + len(b)] += b[: len(x) - o]
    return fx(x, Reverb(room_size=0.5, wet_level=0.25)) * 0.7


def confetti():
    x = np.zeros((ns(1.2), 2), np.float32)
    for _ in range(28):
        p = pop() * rng.uniform(0.15, 0.4)
        o = ns(rng.uniform(0, 0.9))
        a = rng.uniform(0, np.pi / 2)
        seg = x[o:o + len(p)]
        seg[:, 0] += p[: len(seg)] * np.cos(a)
        seg[:, 1] += p[: len(seg)] * np.sin(a)
    return x


def typing(sec=2.6):
    x = np.zeros(ns(sec), np.float32)
    o = 0.0
    while o < sec - 0.05:
        t = np.arange(ns(0.03)) / SR
        k = bp(noise(0.03), 1800, 6500) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 320 * t) * np.exp(-t / 0.008) * 0.4
        i = ns(o)
        x[i:i + len(k)] += k[: len(x) - i] * rng.uniform(0.5, 1.0)
        o += rng.uniform(0.055, 0.11)
    return x * 0.6


def send():
    return whoosh(0.22) * 0.6


def counter(sec=0.9):
    x = np.zeros(ns(sec + 0.3), np.float32)
    o = 0.0
    step = 0.07
    while o < sec:
        tt = tick(2600 + 800 * o / sec)
        i = ns(o)
        x[i:i + len(tt)] += tt
        o += step
        step = max(0.03, step * 0.9)
    b = bell(midi_hz(93), 0.3, 0.5) * 0.4
    i = ns(sec)
    x[i:i + len(b)] += b[: len(x) - i]
    return x


def buzz():
    t = np.arange(ns(0.32)) / SR
    x = np.sign(np.sin(2 * np.pi * 98 * t)) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 18 * t)))
    return lp((x * np.exp(-t / 0.2)).astype(np.float32), 900) * 0.45


def scratch():
    t = np.arange(ns(0.3)) / SR
    rate = 1 + 0.9 * np.sin(2 * np.pi * 7 * t)
    src = bp(noise(0.3), 400, 3000)
    idx = np.clip(np.cumsum(rate).astype(int), 0, len(src) - 1)
    return (src[idx] * np.sin(np.pi * t / 0.3)).astype(np.float32) * 0.6


def zap():
    t = np.arange(ns(0.22)) / SR
    f = 2200 * np.exp(-t / 0.05) + 180
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.08)
    return fx(x.astype(np.float32), Delay(delay_seconds=BEAT / 2, feedback=0.25, mix=0.25)) * 0.4


def swarm():
    x = np.zeros((ns(1.6), 2), np.float32)
    for i in range(18):
        t = np.arange(ns(0.5)) / SR
        f0 = rng.uniform(300, 2500)
        f = f0 + (880 - f0) * (t / 0.5)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.5) * 0.08
        o = ns(rng.uniform(0, 1.0))
        a = rng.uniform(0, np.pi / 2)
        seg = x[o:o + len(y)]
        seg[:, 0] += y[: len(seg)] * np.cos(a)
        seg[:, 1] += y[: len(seg)] * np.sin(a)
    return x


def scribble():
    x = stft_sweep(1.2, 1500, 3500, 0.3, 1.0, lambda tt: 0.5 + 0.5 * np.sin(2 * np.pi * 9 * tt) ** 2)
    return x * 0.35


def pindrop():
    t = np.arange(ns(0.6)) / SR
    f = 1600 * np.exp(-t / 0.06) + 400
    fall = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12) * 0.4
    thud = np.zeros(len(t), np.float32)
    st = stamp()
    thud[ns(0.12):ns(0.12) + len(st)] = st[: len(t) - ns(0.12)]
    return (fall + thud * 0.8).astype(np.float32)


def tick2():
    return tick(1900) * 0.7


SFX = {k: v for k, v in globals().items() if k in {
    "flip", "pop", "tick2", "whoosh", "blip", "zap", "impact", "shimmer", "swoosh", "pindrop", "typing", "send", "lock",
    "sparkle", "counter", "stamp", "cash", "confetti", "dingdong", "chime", "scribble", "buzz", "click", "scratch", "swarm"}}
SFX["sparkle"] = lambda: shimmer() * 0.8 + np.pad(cash(), (0, ns(1.8) - ns(1.6)))


# --------------------------------------------------------------------------- arrangement
class Arr:
    def __init__(self):
        self.orc = Orchestra()
        self.drums = stereo()
        self.low = stereo()
        self.synth = stereo()
        self.fxbus = stereo()
        self.kicks: list[float] = []
        self.k = {h: kick(h) for h in (0.4, 0.7, 1.0)}
        self.sn, self.cl = snare(), clap()
        self.hc, self.ho, self.sh = hat(False), hat(True), shaker()
        self.cr = crash()

    # drums -----------------------------------------------------------------
    def kick(self, at, hard=1.0, db=0.0, force=False):
        if broken(at) and not force:
            return
        self.kicks.append(at)
        place(self.drums, self.k[min(self.k, key=lambda h: abs(h - hard))], at, db)

    def pattern(self, bar0, bars, kick=None, snare=None, clap=None, hats=None, ohats=None, shaker=None, db=0.0, kick_hard=1.0):
        for b in range(bars):
            base = T(bar0 + b)
            ok = lambda s: not broken(base + s * S16)
            kick, snare, clap, hats, ohats, shaker = ([s for s in (v or []) if ok(s)] for v in (kick, snare, clap, hats, ohats, shaker))
            for s in kick or []:
                self.kick(base + s * S16, kick_hard, db)
            for s in snare or []:
                place(self.drums, self.sn, base + s * S16, db - 2, 0.05)
            for s in clap or []:
                place(self.drums, self.cl, base + s * S16, db - 1, -0.05)
            for s in hats or []:
                place(self.drums, self.hc, base + s * S16, db - 9 + (2 if s % 4 == 2 else 0), 0.3)
            for s in ohats or []:
                place(self.drums, self.ho, base + s * S16, db - 10, 0.25)
            for s in shaker or []:
                place(self.drums, self.sh, base + s * S16, db - 14 + (3 if s % 2 else 0), -0.4)

    def snare_roll(self, bar0, bar1, db=0.0):
        steps = int((bar1 - bar0) * 16)
        for i in range(steps):
            prog = i / max(1, steps - 1)
            place(self.drums, self.sn, T(bar0) + i * S16, db - 16 + 14 * prog ** 1.5, 0.05)
            if prog > 0.5:
                place(self.drums, self.sn, T(bar0) + i * S16 + S16 / 2, db - 18 + 12 * prog, 0.05)

    def crash(self, bar, db=-3.0):
        place(self.drums, self.cr, T(bar), db)

    # pitched -----------------------------------------------------------------
    def theme_full(self, bar0, tonic, big=False, phrase=THEME):
        """The theme at full tempo (4 bars for A1+A2), brass and strings with oom-pah below."""
        m = lambda tn, **k: melody(T(bar0), S16, tn, phrase=phrase, **k)
        self.orc.add("brass", 61, m(tonic + 12), 0, 0.0)
        self.orc.add("trumpet", 56, m(tonic + 12, art=0.7, vel=92), -4, -0.15)
        self.orc.add("strings", 48, m(tonic + 24, art=0.9, vel=84), -7, 0.2)
        if big:
            self.orc.add("piccolo", 72, m(tonic + 24, art=0.75, vel=80), -9, 0.3)
            self.orc.add("glock", 9, m(tonic + 24, art=0.6, vel=78), -12, -0.3)
        beats = sum(u for _, _, u in phrase) // 4
        self.oompah(bar0, beats / 4, tonic, PROG[:beats], per_beat=1, tuba=True)

    def stab(self, bar, name, tonic, big=False):
        """A tutti chord hit that sounds through a break."""
        at = T(bar)
        keys = chord_keys(name, tonic + 12)
        root = tonic - 24 + ROOT_OF[name]
        self.orc.add("brass", 61, [(at, 0.22, k, 118) for k in keys], force=True)
        self.orc.add("strings", 48, [(at, 0.22, k + 12, 104) for k in keys], force=True)
        self.orc.add("tuba", 58, [(at, 0.25, root, 118)], force=True)
        self.orc.add("hit", 55, [(at, 0.4, k, 124 if big else 112) for k in chord_keys(name, tonic)], force=True)
        self.orc.add("timp", 47, [(at, 0.3, root + 12, 118)], force=True)
        self.kick(at, 1.0, 1, force=True)
        place(self.low, sub_note(midi_hz(root), 0.5, 0.25), at, -3)
        if big:
            place(self.drums, self.cr, at, -2)

    def oompah(self, bar0, bars, tonic, prog, per_beat=1, tuba=False, stab_prog=0, stab_db=-6, every_beat=True, minor=False):
        """Bass on the beat, chord on the off-beat. per_beat: theme beats per film beat (1 = full tempo, 0.5 = half)."""
        beats = int(bars * 4)
        last = None
        for b in range(beats):
            name = prog[int(b * per_beat) % len(prog)]
            at = T(bar0) + b * BEAT
            root = tonic - 24 + ROOT_OF[name]
            if name == last and b % 2:
                root += 7 if ROOT_OF[name] <= 0 else -5
            last = name
            if tuba:
                self.orc.add("tuba", 58, [(at, BEAT * 0.45, root, 100 if b % 2 == 0 else 88)], 0, 0.0)
            if not broken(at):
                place(self.low, sub_note(midi_hz(root), BEAT * 0.9, 0.22), at, -5)
            if every_beat or b % 2 == 1:
                keys = chord_keys(name, tonic, minor)
                self.orc.add("stabs", stab_prog, [(at + BEAT / 2, BEAT * 0.3, k, 76 + (8 if b % 2 else 0)) for k in keys], stab_db, 0.25)

    def pad(self, bar0, bars, tonic, prog, per_beat=0.5, db=-10, minor=False, program=49):
        beats = int(bars * 4)
        b = 0
        while b < beats:
            name = prog[int(b * per_beat) % len(prog)]
            run = 1
            while b + run < beats and prog[int((b + run) * per_beat) % len(prog)] == name:
                run += 1
            keys = [k - 12 for k in chord_keys(name, tonic, minor)]
            self.orc.add("pad", program, [(T(bar0) + b * BEAT, run * BEAT + 0.05, k, 64) for k in keys], db, 0.0)
            b += run

    def groove(self, bar0, bars, tonic, level=1):
        """Half-time groove under narration, harmony at half speed, fills at phrase ends."""
        kick_steps = [0, 10] if level < 3 else [0, 4, 8, 12]
        self.pattern(bar0, bars, kick=kick_steps, clap=[8] if level < 3 else [4, 12], hats=list(range(0, 16, 2)),
                     shaker=list(range(16)) if level >= 2 else None, ohats=[14] if level >= 2 else None,
                     db=-2 if level < 3 else 0, kick_hard=0.7 if level < 3 else 1.0)
        beats = bars * 4
        last = None
        for b in range(beats):
            name = PROG[(b // 2) % 16]
            at = T(bar0) + b * BEAT
            root = tonic - 24 + ROOT_OF[name]
            if b % 2:
                root += 7 if ROOT_OF[name] <= 0 else -5
            self.orc.add("bass", 32, [(at, BEAT * 0.7, root + 12, 104 if b % 2 == 0 else 92)], 2, 0.0)
            place(self.low, sub_note(midi_hz(root), BEAT * 0.8, 0.2), at, -8)
            if b % 2 == 1:
                keys = chord_keys(name, tonic)
                self.orc.add("keys", 0, [(at + BEAT / 2, BEAT * 0.35, k, 70) for k in keys], -4, 0.35)
                if level >= 2:
                    self.orc.add("mute", 59, [(at + BEAT / 2, BEAT * 0.25, keys[-1] + 12, 70)], -8, -0.35)
        self.pad(bar0, bars, tonic, PROG, 0.5, db=-14)
        # Theme fills on the pizzicato at the end of every second bar.
        for b in range(1, bars, 2):
            name = PROG[((b * 4 + 3) // 2) % 16]
            fill = [(2, 0, 1), (4, 0, 1), (3, 0, 1), (2, 0, 1)] if name == "V7" else [(1, 1, 1), (7, 0, 1), (6, 0, 1), (5, 0, 1)]
            self.orc.add("pizz", 45, melody(T(bar0 + b) + 3 * BEAT, S16, tonic + 12, phrase=fill, vel=82), -3, -0.3)

    def tech(self, bar0, bars, tonic):
        """Engineering drop: four-on-the-floor, reese bass in eighths, pluck synth theme."""
        self.pattern(bar0, bars, kick=[0, 4, 8, 12], clap=[4, 12], hats=list(range(16)), ohats=[2, 6, 10, 14], db=0)
        for b in range(bars * 8):
            name = PROG[(b // 2) % 16]
            root = tonic - 24 + ROOT_OF[name] + (12 if b % 2 else 0)
            place(self.low, reese(midi_hz(root), S16 * 1.8, 700 + 500 * (b % 2)), T(bar0) + b * S16 * 2, -9)
        for k in range(0, bars, 4):
            for ev in melody(T(bar0 + k), S16, tonic, art=0.7):
                s, d, key, v = ev
                place(self.synth, pluck_synth(midi_hz(key), d + 0.15, 1800 + 8 * v), s, -4 + (v - 100) / 10, 0.0)
        self.pad(bar0, bars, tonic, PROG, 1, db=-16, program=49)

    def music_box(self, bar0, tonic):
        mel = melody(T(bar0), S16 * 2, tonic + 12, HARM_MINOR, art=0.9, vel=88, accent=8)
        self.orc.add("musicbox", 10, mel, 0, 0.15)
        self.orc.add("celesta", 8, [(s, d, k - 12, v - 20) for s, d, k, v in mel], -10, -0.2)

    def ending(self, bar, tonic):
        """The galop's closing hits: I I V7 I ... I."""
        hits = [(0, "I", 0.1), (0.125, "I", 0.1), (0.25, "V7", 0.1)]  # then a rest for "Say it once!"
        for off, name, dur in hits:
            at = T(bar + off)
            keys = chord_keys(name, tonic + 12)
            self.orc.add("brass", 61, [(at, dur * BAR, k, 112) for k in keys], 0, 0)
            self.orc.add("strings", 48, [(at, dur * BAR, k + 12, 100) for k in keys], -6, 0.2)
            self.orc.add("tuba", 58, [(at, dur * BAR, tonic - 24 + ROOT_OF[name], 112)], 0, 0)
            self.orc.add("timp", 47, [(at, 0.3, tonic - 24 + ROOT_OF[name] + 12, 110)], -2, 0)
            self.kick(at, 1.0)
            place(self.low, sub_note(midi_hz(tonic - 24 + ROOT_OF[name]), 0.3), at, -4)
        final = T(bar + 1)
        keys = chord_keys("I", tonic + 12) + [tonic + 24]
        self.orc.add("brass", 61, [(final, 2.2, k, 120) for k in keys], 0, 0)
        self.orc.add("strings", 48, [(final, 2.6, k + 12, 110) for k in keys], -4, 0.2)
        self.orc.add("tuba", 58, [(final, 2.0, tonic - 24, 120)], 0, 0)
        self.orc.add("hit", 55, [(final, 0.6, k, 120) for k in chord_keys("I", tonic)], -2, 0)
        roll = [(final + i * 0.05, 0.05, tonic - 12, int(70 + 50 * np.exp(-i / 18))) for i in range(36)]
        self.orc.add("timp", 47, roll, -2, 0)
        self.kick(final, 1.0, 2)
        self.crash(bar + 1, 0)
        place(self.low, sub_note(midi_hz(tonic - 24), 2.4, 0.9), final, -2)


def build():
    a = Arr()
    Dm = D  # cold open in D harmonic minor
    # Cold open (0-8): music box at half speed, pad, clock, riser, silence on the last beat.
    a.music_box(0, Dm)
    a.pad(0, 8, Dm, PROG, 0.5, db=-12, minor=True)
    for b in range(0, 26):
        place(a.fxbus, tick(2300 if b % 2 == 0 else 1700), T(0) + b * BEAT, -10)
    for b in range(0, 12):
        place(a.fxbus, tick(2300 if b % 2 == 0 else 1700), T(6.5) + b * BEAT / 2, -9 + b * 0.4)
    for bar in range(8):
        a.orc.add("timp", 47, [(T(bar), 0.4, Dm - 24 + (0 if bar % 2 == 0 else -5), 70 + bar * 5)], -6, 0)
    place(a.fxbus, riser(T(7.75) - T(5.5)), T(5.5), -4)
    a.snare_roll(6.75, 7.75, -3)

    # Title drop (8-12).
    a.orc.add("hit", 55, [(T(8), 0.5, k, 120) for k in chord_keys("I", D)], -2, 0)
    a.orc.add("timp", 47, [(T(8), 0.5, D - 12, 124)], 0, 0)
    BREAKS.append((T(10), T(10.5)))  # "Meet PairUp!"
    a.theme_full(8, D, big=True)
    a.pattern(8, 4, kick=[0, 4, 8, 12], clap=[4, 12], hats=list(range(16)), ohats=[2, 6, 10, 14], db=0)
    a.crash(8, -1)

    # Grooves under narration.
    a.groove(12, 8, D, level=1)
    a.groove(20, 14, D, level=2)
    place(a.fxbus, riser(T(34) - T(32.5)), T(32.5), -8)
    a.snare_roll(33, 34, -4)

    # Deal (34-38): "Yes!" "Yes!" on stop-time hits, then "Deal!" and the theme's first half.
    BREAKS.append((T(34), T(35)))
    a.stab(34.25, "I", D, big=True)
    a.stab(34.75, "V7", D)
    a.orc.add("hit", 55, [(T(35), 0.5, k, 124) for k in chord_keys("I", D)], -2, 0)
    a.theme_full(35, D, big=True, phrase=A1)
    a.pattern(35, 2, kick=[0, 4, 8, 12], clap=[4, 12], hats=list(range(16)), ohats=[2, 6, 10, 14], db=0)
    a.crash(35, -1)
    a.pad(37, 1, D, ["I", "V7"], per_beat=0.5, db=-10)
    a.pattern(37, 1, kick=[0], hats=list(range(0, 16, 2)), db=-8, kick_hard=0.7)

    # Ring breakdown (38-48): pad, harp, heartbeat; build into services.
    a.pad(38, 10, D, ["I", "I", "IV", "IV", "vi", "vi", "V7", "V7"], per_beat=0.25, db=-9)
    harp_prog = ["I", "IV", "vi", "V7"]
    for b in range(8 * 4):
        name = harp_prog[(b // 8) % 4]
        keys = chord_keys(name, D + 12)
        seq = keys + [keys[0] + 12]
        a.orc.add("harp", 46, [(T(38) + b * BEAT + i * S16 * 2, 0.4, seq[(b * 2 + i) % len(seq)], 70) for i in range(2)], -6, 0.2)
    a.pattern(38, 8, kick=[0, 3], db=-8, kick_hard=0.4)
    a.pattern(46, 1, kick=[0, 4, 8, 12], hats=list(range(0, 16, 2)), db=-6, kick_hard=0.7)
    a.pattern(47, 1, kick=[0, 2, 4, 6, 8, 10, 12, 14], hats=list(range(16)), db=-4, kick_hard=0.7)
    a.snare_roll(47, 48, -4)
    place(a.fxbus, riser(T(48) - T(46.5)), T(46.5), -6)

    a.groove(48, 12, D, level=2)
    a.groove(60, 7, D, level=1)
    a.pattern(67, 1, kick=[0, 4, 8, 12], hats=list(range(16)), db=-4, kick_hard=0.7)
    a.snare_roll(67, 68, -2)
    place(a.fxbus, riser(T(68) - T(66)), T(66), -3)
    place(a.fxbus, reverse_cymbal(BAR), T(67), -6)

    # Engineering drop (68-84).
    a.orc.add("hit", 55, [(T(68), 0.5, k, 120) for k in chord_keys("I", D)], -3, 0)
    a.tech(68, 16, D)
    a.crash(68, -1)
    a.crash(76, -6)
    place(a.fxbus, riser(T(84) - T(82.5)), T(82.5), -9)

    # Impact (84-96): driving groove.
    a.groove(84, 12, D, level=3)
    a.crash(84, -5)
    a.snare_roll(95, 96, -6)

    # Finale (96-106): build, gap, final chorus up a whole step, ending.
    a.groove(96, 3, D, level=3)
    a.pattern(99, 1, kick=[0, 2, 4, 6], hats=list(range(8)), db=-2)
    a.snare_roll(99, 99.5, 0)
    place(a.fxbus, riser(T(99.5) - T(98)), T(98), -2)
    place(a.fxbus, reverse_cymbal(T(99.5) - T(98.5)), T(98.5), -6)
    E = D + 2
    a.orc.add("hit", 55, [(T(100), 0.5, k, 124) for k in chord_keys("I", E)], 0, 0)
    a.orc.add("timp", 47, [(T(100), 0.5, E - 12, 124)], 0, 0)
    a.theme_full(100, E, big=True)
    a.pattern(100, 4, kick=[0, 4, 8, 12], clap=[4, 12], hats=list(range(16)), ohats=[2, 6, 10, 14], db=1)
    a.crash(100, 0)
    a.ending(104, E)
    return a


def gap(x: np.ndarray, at: float, until: float, fade=0.01):
    """Silence [at, until) with short fades, for the breath before a drop."""
    i, j, f = ns(at), ns(until), ns(fade)
    x[i - f:i] *= np.linspace(1, 0, f)[:, None]
    x[i:j] = 0
    x[j:j + f] *= np.linspace(0, 1, f)[:, None]


def sidechain(x: np.ndarray, kicks, depth=0.6, tau=0.11):
    env = np.ones(N, np.float32)
    t = np.arange(ns(0.5)) / SR
    shape = 1 - depth * np.exp(-t / tau) * np.minimum(t / 0.004, 1)
    for k in kicks:
        i = ns(k)
        j = min(N, i + len(shape))
        env[i:j] = np.minimum(env[i:j], shape[: j - i])
    return x * env[:, None]


# Target loudness of each part while it plays (dBFS RMS over its active samples).
LEVEL = {"brass": -17, "trumpet": -23, "strings": -23, "piccolo": -27, "glock": -29, "musicbox": -22, "celesta": -29,
         "pad": -29, "timp": -22, "hit": -17, "tuba": -19, "stabs": -25, "bass": -19, "keys": -25, "pizz": -22,
         "mute": -29, "harp": -26}


def level(x: np.ndarray, target_db: float) -> np.ndarray:
    m = np.abs(x).max(axis=1) > 1e-3
    if not m.any():
        return x
    rms = np.sqrt(np.mean(x[m] ** 2))
    return x * (10 ** (target_db / 20) / rms)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    a = build()
    mid = stereo()
    low = a.low.copy()
    wet = [("brass", Reverb(room_size=0.55, wet_level=0.18, dry_level=0.85)), ("trumpet", Reverb(room_size=0.5, wet_level=0.15)),
           ("strings", Reverb(room_size=0.7, wet_level=0.25)), ("piccolo", Reverb(room_size=0.6, wet_level=0.2)),
           ("glock", Reverb(room_size=0.7, wet_level=0.3)), ("musicbox", Reverb(room_size=0.85, wet_level=0.4)),
           ("celesta", Reverb(room_size=0.85, wet_level=0.4)), ("pad", Reverb(room_size=0.9, wet_level=0.35)),
           ("harp", Reverb(room_size=0.8, wet_level=0.35)), ("hit", Reverb(room_size=0.8, wet_level=0.3)),
           ("pizz", Reverb(room_size=0.5, wet_level=0.2)), ("keys", Reverb(room_size=0.4, wet_level=0.15)),
           ("mute", Reverb(room_size=0.4, wet_level=0.15)), ("stabs", Reverb(room_size=0.4, wet_level=0.15)),
           ("timp", Reverb(room_size=0.7, wet_level=0.25))]
    verb = dict(wet)
    for name in a.orc.parts:
        x = level(a.orc.render(name), LEVEL.get(name, -26) + a.orc.parts[name]["gain"] * 0)
        if name in verb:
            x = fx(x, verb[name])
        if name in ("tuba", "bass", "timp"):
            low += x
        else:
            mid += x
        print("rendered", name, f"peak {np.max(np.abs(x)):.3f}")
    mid += fx(a.synth, Chorus(rate_hz=0.6, depth=0.3, mix=0.3), Delay(delay_seconds=BEAT * 0.75, feedback=0.2, mix=0.18),
              Reverb(room_size=0.5, wet_level=0.15))
    drums = fx(a.drums, Compressor(threshold_db=-14, ratio=3, attack_ms=8, release_ms=120))
    # Tech section pumps against the kick; everything breathes before each drop.
    t0, t1 = ns(T(68)), ns(T(84))
    low[t0:t1] = sidechain(low, a.kicks, 0.7)[t0:t1]
    mid[t0:t1] = sidechain(mid, a.kicks, 0.35)[t0:t1]
    for bus in (drums, low, mid, a.fxbus):
        gap(bus, T(7.75), T(8))
        gap(bus, T(34), T(34.25))
        gap(bus, T(99.5), T(100))
    sfx = stereo()
    for c in TL["cues"]:
        x = SFX[c["sfx"]]()
        place(sfx, x if x.ndim == 2 else x, T(c["at"]), c.get("gain", 0))
    sfx += a.fxbus
    for name, x in [("drums", drums), ("low", low), ("mid", mid), ("sfx", sfx)]:
        sf.write(OUT / f"{name}.wav", x, SR, subtype="FLOAT")
        print(name, f"peak {np.max(np.abs(x)):.3f} rms {np.sqrt(np.mean(x ** 2)):.4f}")
    json.dump({"kicks": sorted(a.kicks)}, open(OUT / "kicks.json", "w"))


if __name__ == "__main__":
    main()
