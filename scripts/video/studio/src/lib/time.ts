// The beat grid shared with the soundtrack: timeline.json is the single source.
import { Easing, interpolate, spring } from "remotion";
import timeline from "../../../timeline.json";
import vo from "../generated/vo.json";

export const TL = timeline as {
  bpm: number; beatsPerBar: number; fps: number; bars: number; tailSeconds: number;
  scenes: { id: string; start: number; bars: number }[];
  cues: { at: number; sfx: string; tag: string }[];
};
export const VO = vo as { id: string; who: string; text: string; start: number; duration: number; words: { w: string; t: number; d: number }[] }[];

export const FPS = TL.fps;
export const BAR_S = (60 / TL.bpm) * TL.beatsPerBar;
export const BAR = BAR_S * FPS; // frames per bar (96)
export const BEAT = BAR / TL.beatsPerBar; // frames per beat (24)
export const TOTAL = Math.round((TL.bars * BAR_S + TL.tailSeconds) * FPS);

/** Frame of a bar position (absolute). */
export const fb = (bar: number) => Math.round(bar * BAR);

export const scene = (id: string) => {
  const s = TL.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}`);
  return s;
};

/** Frame (relative to the scene start) of a cue's bar position. */
export const cue = (tag: string, sceneStart: number) => {
  const c = TL.cues.find((x) => x.tag === tag);
  if (!c) throw new Error(`no cue ${tag}`);
  return fb(c.at - sceneStart);
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 over [start, start+dur] frames with an ease. */
export const ramp = (f: number, start: number, dur: number, ease = Easing.bezier(0.2, 0.8, 0.2, 1)) =>
  interpolate(f, [start, start + dur], [0, 1], { ...clamp, easing: ease });

export const easeIn = Easing.bezier(0.6, 0, 0.9, 0.4);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** A punchy spring that starts at `start` (frames). */
export const pop = (f: number, start: number, stiffness = 220, damping = 13, mass = 0.7) =>
  f < start ? 0 : spring({ frame: f - start, fps: FPS, config: { stiffness, damping, mass } });

/** A heavier settle for big objects. */
export const glide = (f: number, start: number) =>
  f < start ? 0 : spring({ frame: f - start, fps: FPS, config: { stiffness: 90, damping: 18, mass: 1 } });

/** Decaying flash after each beat in [from, to) bars (absolute), for beat-synced punches. */
export const beatPulse = (frame: number, fromBar: number, toBar: number, every = 1, decay = 7) => {
  const bar = frame / BAR;
  if (bar < fromBar || bar >= toBar) return 0;
  const sinceBeat = (frame - fb(fromBar)) % (BEAT * every);
  return Math.exp(-sinceBeat / decay);
};
