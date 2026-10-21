import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Captions } from "./components/Captions";
import { Grain, StripeWipe, Vignette } from "./components/base";
import { C } from "./lib/theme";
import { fb, scene, TL } from "./lib/time";
import { Cold } from "./scenes/Cold";
import { Title } from "./scenes/Title";
import { What } from "./scenes/What";
import { Seller } from "./scenes/Seller";
import { Buyer } from "./scenes/Buyer";
import { Deal } from "./scenes/Deal";
import { Ring } from "./scenes/Ring";
import { Services } from "./scenes/Services";
import { Context } from "./scenes/Context";
import { Tech } from "./scenes/Tech";
import { Impact } from "./scenes/Impact";
import { Finale } from "./scenes/Finale";

const SCENES: Record<string, React.FC> = { cold: Cold, title: Title, what: What, seller: Seller, buyer: Buyer, deal: Deal, ring: Ring, services: Services, context: Context, tech: Tech, impact: Impact, finale: Finale };

/** A slow camera push across each scene, so held moments keep moving. */
const Dolly: React.FC<{ bars: number; children: React.ReactNode }> = ({ bars, children }) => {
  const f = useCurrentFrame();
  const s = 1 + 0.035 * Math.min(1, f / fb(bars));
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

// Cuts covered by the kick-line stripe wipe (bar positions).
const WIPES = [20, 38, 48, 60, 84, 96];

export const Film: React.FC<{ audio?: boolean }> = ({ audio = true }) => {
  const f = useCurrentFrame();
  const last = TL.scenes[TL.scenes.length - 1];
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      {TL.scenes.map((s, i) => {
        const Comp = SCENES[s.id];
        const end = i === TL.scenes.length - 1 ? 10_000 : fb(s.bars);
        return (
          <Sequence key={s.id} from={fb(s.start)} durationInFrames={end} name={s.id}>
            <Dolly bars={s.bars}>
              <Comp />
            </Dolly>
          </Sequence>
        );
      })}
      {WIPES.map((b) => <StripeWipe key={b} at={fb(b) - 9} dur={18} />)}
      <Vignette strength={0.55} />
      <Grain opacity={0.085} />
      <Captions hide={(t) => t > (last.start + 6) * 1.6} />
      {audio ? <Audio src={staticFile("assets/mix.wav")} /> : null}
      {f < 0 ? null : null}
    </AbsoluteFill>
  );
};
