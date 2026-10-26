// Where a sign-in redirect (Google/X, or the emailed link) lands:
// augchess://auth?code=… — trade the code for a session, then go on.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { exchangeCode, currentSession } from '../lib/auth.js';
import { S } from '../theme.js';

export default function AuthRedirect() {
  const { code } = useLocalSearchParams();
  const [message, setMessage] = useState('Signing you in…');
  useEffect(() => {
    if (!code) return;
    exchangeCode(String(code)).then(({ error }) => {
      // On some phones the browser flow already traded this code itself.
      if (error && !currentSession()) setMessage(error.message || 'Sign-in failed — try again.');
      else router.replace('/account');
    });
  }, [code]);
  return <View style={[S.screen, { padding: 16 }]}><Text style={S.body}>{message}</Text></View>;
}
