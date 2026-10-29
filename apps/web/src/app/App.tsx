import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { GamePage } from '../game/GamePage';
import { GameProvider } from '../game/GameProvider';
import { SettingsProvider } from '../game/SettingsProvider';
import { HistoryPage } from '../history/HistoryPage';
import { PreferencesProvider } from '../prefs/PreferencesProvider';
import { VerifyPage } from '../verify/VerifyPage';
import { Header } from './Header';

export function App() {
  return (
    <BrowserRouter>
      <PreferencesProvider>
        <SettingsProvider>
          <GameProvider>
            <div className="flex min-h-dvh flex-col">
              <Header />
              <Routes>
                <Route path="/" element={<GamePage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/verify" element={<VerifyPage />} />
                <Route path="/verify/:roundId" element={<VerifyPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </GameProvider>
        </SettingsProvider>
      </PreferencesProvider>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg text-ink">This page doesn't exist.</p>
      <Link to="/" className="text-gauge underline underline-offset-4">
        Back to the game
      </Link>
    </main>
  );
}
