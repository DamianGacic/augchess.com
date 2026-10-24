/**
 * supabase-config.js — Project-specific Supabase credentials for auth.js.
 * The anon key is meant to be public (access is enforced by RLS policies on
 * the Supabase project, not by hiding this key), so it's fine to commit.
 *
 * Fill these in after creating a project at https://supabase.com — Project
 * Settings -> API -> Project URL / anon public key.
 */
let SUPABASE_URL = 'https://eosvuuqvzlibokvgtwnl.supabase.co';
let SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvc3Z1dXF2emxpYm9rdmd0d25sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTAwNTEsImV4cCI6MjEwMDQ4NjA1MX0.ILougFqmuWg_86sQlwWuevysEYdkrFXyYAoZ3GW5yPA';

// Served from localhost: use the local Supabase from `supabase start` (see
// supabase/config.toml) so testing never touches the hosted project or its
// email limits. These are the CLI's fixed, public demo values.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  SUPABASE_URL = 'http://127.0.0.1:54321';
  SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
}
