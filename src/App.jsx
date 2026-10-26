import { useEffect } from 'react';
import { useStore } from './store.js';
import Header from './components/Header.jsx';
import AuthModal from './components/AuthModal.jsx';
import HomePage from './pages/HomePage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AugmentsPage from './pages/AugmentsPage.jsx';
import FiguresPage from './pages/FiguresPage.jsx';
import GameSettingsModal from './game/GameSettingsModal.jsx';
import PromotionModal from './game/PromotionModal.jsx';
import DraftModal from './game/DraftModal.jsx';

const PAGES = {
  home: HomePage,
  leaderboard: LeaderboardPage,
  history: HistoryPage,
  account: SettingsPage,
  augments: AugmentsPage,
  figures: FiguresPage,
};

export default function App() {
  const { view } = useStore();
  const Page = PAGES[view];

  // The game screen is still static markup in index.html (classic scripts).
  useEffect(() => {
    document.getElementById('game-view').classList.toggle('hidden', view !== 'game');
  }, [view]);

  return (
    <>
      <Header />
      {Page && <div className="view"><Page /></div>}
      <GameSettingsModal />
      <DraftModal />
      <PromotionModal />
      <AuthModal />
    </>
  );
}
