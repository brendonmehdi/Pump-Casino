import { AnimatePresence, motion } from 'motion/react';
import { useId } from 'react';

export type BalloonMood = 'idle' | 'active' | 'popped' | 'released' | 'expired';

interface BalloonProps {
  /** 0 → 1 as the balloon climbs the ladder. */
  readonly pressure: number;
  readonly mood: BalloonMood;
  /** Changes on every confirmed pump so the latex visibly takes the air in. */
  readonly pulseKey: string;
  /** True while a pump is waiting for the server: anticipation only, never the outcome. */
  readonly straining: boolean;
  readonly reducedMotion: boolean;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const mix = (a: Hsl, b: Hsl, t: number): string =>
  `hsl(${(a.h + (b.h - a.h) * t).toFixed(1)} ${(a.s + (b.s - a.s) * t).toFixed(1)}% ${(a.l + (b.l - a.l) * t).toFixed(1)}%)`;

// Latex goes from soft bubblegum to stretched, glowing red as the pressure rises.
const BODY_COOL = { h: 347, s: 100, l: 76 };
const BODY_HOT = { h: 355, s: 96, l: 58 };
const SHINE_COOL = { h: 345, s: 100, l: 93 };
const SHINE_HOT = { h: 12, s: 100, l: 90 };
const RIM_COOL = { h: 343, s: 62, l: 44 };
const RIM_HOT = { h: 352, s: 88, l: 30 };

const IDLE_SCALE = 0.5;
const IDLE_OPACITY = 0.55;
/** The balloon grows from its knot, which sits this far down the drawing. */
const KNOT_ORIGIN = '50% 78%';

/** sqrt makes the first pumps visibly grow the balloon; the last ones mostly stretch it. */
const scaleFor = (t: number) => 0.56 + 0.44 * Math.sqrt(t);

/** Deterministic shard layout for the pop (no randomness during render). */
const SHARDS = Array.from({ length: 11 }, (_, index) => {
  const angle = (index / 11) * Math.PI * 2 + ((index * 37) % 11) * 0.05;
  const reach = 70 + ((index * 53) % 5) * 14;
  return {
    x: Math.cos(angle) * reach,
    y: Math.sin(angle) * reach * 0.8 + 36,
    rotate: ((index * 71) % 9) * 40 - 160,
    path: index % 3 === 0 ? 'M0 0 q9 -7 17 1 q-5 9 -15 6 z' : 'M0 0 q6 -9 13 -2 q2 8 -9 9 z',
  };
});

export function Balloon({ pressure, mood, pulseKey, straining, reducedMotion }: BalloonProps) {
  const id = useId();
  const t = Math.min(1, Math.max(0, pressure));
  const scale = scaleFor(t);
  const live = mood === 'idle' || mood === 'active';
  const tremble = !reducedMotion && mood === 'active' && t > 0.55;
  const swayDegrees = reducedMotion || mood !== 'active' ? 0 : 0.8 + 2.6 * t;

  return (
    <div
      // On desktop the balloon gets whatever height is left after the header, multiplier, stats
      // and action bar (about 27rem), so Bet and Pump stay on screen on 720px-tall laptops.
      className="relative mx-auto aspect-[200/280] w-full max-w-[min(54vw,19rem,38dvh)] lg:max-w-[max(9rem,min(19rem,calc((100dvh_-_27rem)/1.4)))] [@media(max-height:520px)]:w-[24dvh]"
      aria-hidden="true"
    >
      <AnimatePresence>
        {live && (
          <motion.div
            key="balloon"
            className="absolute inset-0"
            style={{ transformOrigin: KNOT_ORIGIN }}
            initial={{ scale: IDLE_SCALE, opacity: IDLE_OPACITY }}
            animate={{
              scale: mood === 'idle' ? IDLE_SCALE : straining ? scale * 1.012 : scale,
              opacity: mood === 'idle' ? IDLE_OPACITY : 1,
              rotate: swayDegrees === 0 ? 0 : [-swayDegrees, swayDegrees],
            }}
            exit={{ opacity: 0, transition: { duration: 0.05 } }}
            transition={{
              scale: { type: 'spring', stiffness: 260, damping: 14 },
              opacity: { duration: 0.3 },
              rotate:
                swayDegrees === 0
                  ? { duration: 0.4 }
                  : {
                      duration: 2.4 - 1.5 * t,
                      repeat: Infinity,
                      repeatType: 'mirror',
                      ease: 'easeInOut',
                    },
            }}
          >
            <motion.svg
              key={pulseKey}
              viewBox="0 0 200 280"
              className="h-full w-full overflow-visible"
              style={{ transformOrigin: KNOT_ORIGIN }}
              initial={reducedMotion ? false : { scaleX: 0.95, scaleY: 1.06 }}
              animate={
                tremble
                  ? { scaleX: 1, scaleY: 1, x: [-0.6 * t, 0.6 * t] }
                  : { scaleX: 1, scaleY: 1, x: 0 }
              }
              transition={{
                scaleX: { type: 'spring', stiffness: 520, damping: 11 },
                scaleY: { type: 'spring', stiffness: 520, damping: 11 },
                x: tremble
                  ? { duration: 0.07, repeat: Infinity, repeatType: 'mirror' }
                  : { duration: 0 },
              }}
            >
              <BalloonShape t={t} gradientId={`${id}-live`} />
            </motion.svg>
          </motion.div>
        )}
      </AnimatePresence>

      {mood === 'released' && !reducedMotion && (
        // Cashing out lets go of the balloon: it floats up and away, string and all.
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: KNOT_ORIGIN }}
          initial={{ y: 0, scale, rotate: 0, opacity: 1 }}
          animate={{ y: '-135%', scale, rotate: [0, -6, 4, -3], opacity: [1, 1, 0] }}
          transition={{ duration: 1.5, ease: [0.5, 0, 0.75, 0.4] }}
        >
          <svg viewBox="0 0 200 280" className="h-full w-full overflow-visible">
            <BalloonShape t={t} gradientId={`${id}-free`} />
          </svg>
        </motion.div>
      )}

      {mood === 'popped' && !reducedMotion && <PopBurst t={t} />}

      {!live && (
        // The next, still-empty balloon drifts back in once the result has had its moment.
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: KNOT_ORIGIN }}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: IDLE_SCALE, opacity: IDLE_OPACITY }}
          transition={{ delay: reducedMotion ? 0 : mood === 'released' ? 1.4 : 0.9, duration: 0.5 }}
        >
          <svg viewBox="0 0 200 280" className="h-full w-full overflow-visible">
            <BalloonShape t={0} gradientId={`${id}-next`} />
          </svg>
        </motion.div>
      )}
    </div>
  );
}

/** Latex, knot, string and the printed logo, which stretches and fades as the latex thins. */
function BalloonShape({ t, gradientId }: { readonly t: number; readonly gradientId: string }) {
  const body = mix(BODY_COOL, BODY_HOT, t);
  const rim = mix(RIM_COOL, RIM_HOT, t);
  const shine = mix(SHINE_COOL, SHINE_HOT, t);
  return (
    <>
      <defs>
        <radialGradient id={gradientId} cx="0.36" cy="0.3" r="0.82">
          <stop offset="0" stopColor={shine} />
          <stop offset={(0.42 + 0.12 * t).toFixed(2)} stopColor={body} />
          <stop offset="1" stopColor={rim} />
        </radialGradient>
      </defs>
      <path
        d="M100 212 C 90 228, 110 242, 99 258 S 104 276, 100 280"
        fill="none"
        stroke="#cfe3dd"
        strokeOpacity="0.45"
        strokeWidth="1.4"
      />
      <path d="M93 199 L107 199 L102 212 L98 212 Z" fill={rim} />
      <path
        d="M100 12 C 152 12, 184 52, 184 104 C 184 152, 142 190, 107 200 L 93 200 C 58 190, 16 152, 16 104 C 16 52, 48 12, 100 12 Z"
        fill={`url(#${gradientId})`}
      />
      <text
        x="100"
        y="122"
        textAnchor="middle"
        fontFamily="Anybody Variable, sans-serif"
        fontWeight="800"
        fontSize="30"
        fill={rim}
        fillOpacity={0.42 - 0.26 * t}
        transform={`translate(100 112) scale(${(1 + 0.35 * t).toFixed(3)} 1) translate(-100 -112)`}
      >
        PUMP
      </text>
      <ellipse
        cx="66"
        cy="62"
        rx={13 + 6 * t}
        ry={24 + 8 * t}
        transform="rotate(-28 66 62)"
        fill="white"
        fillOpacity={0.38 + 0.22 * t}
      />
      <ellipse
        cx="146"
        cy="150"
        rx="9"
        ry="16"
        transform="rotate(30 146 150)"
        fill="white"
        fillOpacity="0.08"
      />
    </>
  );
}

/** A quiet pop: a faint ring and desaturated tatters falling away. No flash, no shake. */
function PopBurst({ t }: { readonly t: number }) {
  const body = mix(BODY_COOL, BODY_HOT, t);
  return (
    <svg viewBox="0 0 200 280" className="absolute inset-0 h-full w-full overflow-visible">
      <motion.circle
        cx="100"
        cy="106"
        r="70"
        fill="none"
        stroke="#9fb5b0"
        strokeWidth="1.5"
        initial={{ scale: 0.6, opacity: 0.35 }}
        animate={{ scale: 1.5, opacity: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        style={{ transformOrigin: '100px 106px' }}
      />
      {SHARDS.map((shard, index) => (
        <motion.path
          key={index}
          d={shard.path}
          fill={body}
          initial={{ x: 100, y: 106, rotate: 0, opacity: 0.9, scale: 1.4 }}
          animate={{
            x: [100, 100 + shard.x, 100 + shard.x * 1.1],
            y: [106, 106 + shard.y - 30, 106 + shard.y + 90],
            rotate: shard.rotate,
            opacity: [0.9, 0.7, 0],
            scale: 1,
          }}
          transition={{ duration: 0.95, ease: 'easeOut', times: [0, 0.35, 1] }}
          style={{ filter: 'saturate(0.35)' }}
        />
      ))}
    </svg>
  );
}
