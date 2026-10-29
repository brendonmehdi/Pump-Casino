import { Component } from 'react';
import type { ReactNode } from 'react';

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Keeps one broken page from blanking the whole app. React still reports the error to the
 * console; the player gets a way back to the game, whose state lives safely on the server.
 */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg text-ink">Something on this page broke.</p>
        <p className="max-w-sm text-sm text-ink-muted">
          Your balance and any open round are saved on the server.
        </p>
        <a href="/" className="text-gauge underline underline-offset-4">
          Back to the game
        </a>
      </main>
    );
  }
}
