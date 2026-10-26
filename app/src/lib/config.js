// Where the game server and Supabase live. In development the phone reaches
// your computer over the LAN, so both default to the host Expo Go loaded the
// bundle from (the game server on :8000, local Supabase on :54321).
// EXPO_PUBLIC_SERVER_URL / EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY override.
import Constants from 'expo-constants';

const devHost = !__DEV__ ? null
  : Constants.expoConfig && Constants.expoConfig.hostUri ? Constants.expoConfig.hostUri.split(':')[0]
  : typeof location !== 'undefined' ? location.hostname // `expo start --web`
  : null;

export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ||
  (devHost ? `http://${devHost}:8000` : 'https://augchess.com');

export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

// The anon keys are public by design (supabase-config.js says why).
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ||
  (devHost ? `http://${devHost}:54321` : 'https://eosvuuqvzlibokvgtwnl.supabase.co');

export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (devHost
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvc3Z1dXF2emxpYm9rdmd0d25sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTAwNTEsImV4cCI6MjEwMDQ4NjA1MX0.ILougFqmuWg_86sQlwWuevysEYdkrFXyYAoZ3GW5yPA');
