import { motion } from 'motion/react';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, NavLink } from 'react-router';
import { useGame } from '../game/gameContext';
import { money } from '../lib/format';
import { usePreferences } from '../prefs/preferencesContext';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 transition-colors ${isActive ? 'bg-night-3 text-ink' : 'text-ink-muted hover:text-ink'}`;

export function Header() {
  const { state } = useGame();
  return (
    <header className="mx-auto flex w-full max-w-[1440px] items-center gap-3 px-4 py-3 lg:px-6">
      <Link
        to="/"
        className="font-display text-2xl leading-none font-[900] tracking-tight text-latex"
        style={{ fontStretch: '150%' }}
        aria-label="Pump, back to the game"
      >
        PUMP
      </Link>
      <nav aria-label="Main" className="hidden gap-1 text-sm sm:flex">
        <NavLink to="/" end className={navClass}>
          Play
        </NavLink>
        <NavLink to="/history" className={navClass}>
          History
        </NavLink>
        <NavLink to="/verify" className={navClass}>
          Verify
        </NavLink>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {state && <Balance cents={state.wallet.balanceCents} />}
        <SettingsMenu />
      </div>
    </header>
  );
}

/** Updates instantly; a rise (a win) glows aqua for a moment, a fall stays quiet. */
function Balance({ cents }: { readonly cents: string }) {
  const [shown, setShown] = useState(cents);
  const [wins, setWins] = useState(0);
  if (cents !== shown) {
    if (BigInt(cents) > BigInt(shown)) setWins((count) => count + 1);
    setShown(cents);
  }
  return (
    <div className="flex flex-col items-end leading-tight" data-testid="balance">
      <motion.span
        key={wins}
        className="text-base font-semibold tabular sm:text-lg"
        initial={wins === 0 ? false : { color: '#5ef0c8', scale: 1.06 }}
        animate={{ color: '#e8f3ef', scale: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        aria-label={`Balance ${money(cents)} in play money`}
      >
        {money(cents)}
      </motion.span>
      <span className="text-[0.7rem] text-ink-faint">play money</span>
    </div>
  );
}

function SettingsMenu() {
  const prefs = usePreferences();
  const volumeId = useId();
  const closeOnEscape = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key === 'Escape') event.currentTarget.open = false;
  };
  return (
    <details className="relative" onKeyDown={closeOnEscape}>
      <summary
        className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-ink/12 text-ink-muted hover:text-ink marker:hidden"
        aria-label="Sound, motion and shortcuts"
      >
        <SpeakerIcon muted={prefs.muted} />
      </summary>
      <div className="absolute right-0 z-30 mt-2 flex w-72 flex-col gap-4 rounded-2xl border border-ink/12 bg-night-2 p-4 text-sm shadow-2xl shadow-black/40">
        <nav aria-label="Pages" className="flex gap-1 sm:hidden">
          <NavLink to="/" end className={navClass}>
            Play
          </NavLink>
          <NavLink to="/history" className={navClass}>
            History
          </NavLink>
          <NavLink to="/verify" className={navClass}>
            Verify
          </NavLink>
        </nav>
        {!prefs.soundSupported && (
          <p className="text-xs text-ink-faint">This browser can't play game sounds.</p>
        )}
        <Switch
          label="Sound"
          checked={!prefs.muted}
          onChange={(on) => {
            prefs.setMuted(!on);
          }}
          testId="sound-toggle"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={volumeId} className="text-ink-muted">
            Volume
          </label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            value={Math.round(prefs.volume * 100)}
            disabled={prefs.muted}
            onChange={(event) => {
              prefs.setVolume(Number(event.target.value) / 100);
            }}
            className="accent-win"
          />
        </div>
        <Switch
          label="Reduce motion"
          checked={prefs.reduceMotionSetting}
          onChange={prefs.setReduceMotionSetting}
          testId="motion-toggle"
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-muted">
          <dt>
            <kbd className="rounded-md bg-night-3 px-1.5 py-0.5 text-xs text-ink">Space</kbd>
          </dt>
          <dd>Pump</dd>
          <dt>
            <kbd className="rounded-md bg-night-3 px-1.5 py-0.5 text-xs text-ink">Enter</kbd>
          </dt>
          <dd>Cash out</dd>
          <dt>
            <kbd className="rounded-md bg-night-3 px-1.5 py-0.5 text-xs text-ink">Esc</kbd>
          </dt>
          <dd>Stop auto-bet or close a message</dd>
        </dl>
      </div>
    </details>
  );
}

function Switch(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-ink-muted">
        {props.label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => {
          props.onChange(!props.checked);
        }}
        className={`relative h-7 w-12 rounded-full transition-colors ${props.checked ? 'bg-win/70' : 'bg-ink/15'}`}
        data-testid={props.testId}
      >
        <span
          className={`absolute top-1 left-1 size-5 rounded-full bg-ink transition-transform ${props.checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}

function SpeakerIcon({ muted }: { readonly muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" strokeLinejoin="round" />
      {muted ? (
        <path d="M16 9.5l5 5m0-5l-5 5" strokeLinecap="round" />
      ) : (
        <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" strokeLinecap="round" />
      )}
    </svg>
  );
}
