import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initAuth } from '../lib/auth.js';
import { DetailSheet } from '../components/augmentBits.js';
import { C } from '../theme.js';

export default function RootLayout() {
  useEffect(() => { initAuth(); }, []);
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.bg1 },
          headerTintColor: C.textBright,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: C.bg0 },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'AugChess' }} />
        <Stack.Screen name="game" options={{ title: 'Game' }} />
        <Stack.Screen name="augments" options={{ title: 'Augments' }} />
        <Stack.Screen name="figures" options={{ title: 'Figures' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboards' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
        <Stack.Screen name="account" options={{ title: 'Settings' }} />
        <Stack.Screen name="auth" options={{ title: 'Signing in' }} />
      </Stack>
      <DetailSheet />
    </>
  );
}
