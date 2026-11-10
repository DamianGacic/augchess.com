// React entry. Runs after the classic <script>s in index.html, so their
// top-level globals (Auth, Settings, AUGMENTS, AiPlayer, createGameLink, …)
// are in scope here by bare name.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from './App.jsx';
import { setState, showView } from './store.js';
import './gameBridge.js';

// app.js and ai-player.js still navigate with a global showView().
window.showView = showView;

Auth.onChange((session, profile) => setState({ session, profile }));
// Opened from a password reset email: ask for the new password.
Auth.onPasswordRecovery(() => setState({ authOpen: true, authMode: 'reset' }));
Auth.init();

// A correspondence invite link (?corr=<id>): the Correspondence page shows
// the invitation, or opens the game if it's already yours.
const corrId = getCorrespondenceIdFromUrl();
if (corrId) setState({ view: 'correspondence', corrInvite: corrId });

// Synchronous first render: the header's #mp-badge has to exist before
// app.js's DOMContentLoaded handler can update it.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<App />));

loadAugmentDescriptions().then(() => setState({ descsLoaded: true }));
