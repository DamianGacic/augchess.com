// The game screen: board, both players' clocks, everything you can do this
// turn, and the settings/draft steps on top while a game is being set up.
import { useEffect } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Game from '../lib/game.js';
import { G, useGame } from '../lib/game.js';
import Board from '../components/Board.js';
import { PlayerBar, StatusLine, AbilityBar, VanguardPanel, ShieldPanel, Controls, GameTabs } from '../components/GamePanels.js';
import { SettingsSheet, DraftSheet, PromotionSheet, LobbySheet } from '../components/GameSheets.js';
import { S } from '../theme.js';

function title() {
  if (G.replay) return 'Replay';
  if (G.netMode) {
    const dot = G.connection === 'online' ? '🟢' : G.connection === 'reconnecting' ? '🟡' : '🔴';
    const seat = G.myColor === 'w' ? 'White' : G.myColor === 'b' ? 'Black' : 'Spectator';
    return G.connection === 'online' ? `${dot} ${G.rankedGame ? 'Ranked' : 'Online'} · ${seat}` : `${dot} ${G.connection === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}`;
  }
  return G.vsAi ? 'vs AI' : 'Local game';
}

export default function GameScreen() {
  useGame();
  const { width, height } = useWindowDimensions();
  const size = Math.floor(Math.min(width - 24, height * 0.58));
  useEffect(() => () => Game.leaveGame(), []);
  const bottom = G.flipped ? 'b' : 'w';
  const top = bottom === 'w' ? 'b' : 'w';
  // Closing the lobby while still searching or joining means giving up on it.
  const onLobbyClose = () => { if (!G.state.game && G.state.phase === 'settings' && !G.netMode) router.back(); };

  return (
    <View style={S.screen}>
      <Stack.Screen options={{ title: title() }} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <PlayerBar color={top} />
        <View style={{ alignItems: 'center' }}><Board size={size} /></View>
        <PlayerBar color={bottom} />
        <StatusLine />
        <VanguardPanel />
        <ShieldPanel />
        <AbilityBar />
        <Controls />
        <GameTabs />
      </ScrollView>
      <SettingsSheet />
      <DraftSheet />
      <PromotionSheet />
      <LobbySheet onClose={onLobbyClose} />
    </View>
  );
}
