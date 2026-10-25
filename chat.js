/**
 * chat.js — The in-game chat panel. In online games lines go to the server
 * as {type:'chat', text} (never through the engine — see server/rooms.js
 * addChat) and come back to everyone in the room. Against the AI there's
 * no server, so lines just show up locally and the bot answers with a canned
 * line (handy for trying the panel out);
 * hotseat has nobody to talk to, so the input stays disabled there.
 *
 * Depends on: netclient.js (NetClient), app.js (netMode, myColor, aiColor).
 */
const Chat = (() => {
  const list = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  // ponytail: canned lines, not conversation — swap for something smarter if the bot ever needs to talk.
  const BOT_LINES = ['Good luck!', 'Interesting move…', 'Hmm, let me think.', 'Nice try.', 'Is that your best?', 'GG so far.'];
  const BOT_REPLY_MS = 800;

  function add({ color, text }) {
    const row = document.createElement('div');
    row.className = 'chat-msg';
    const name = document.createElement('span');
    name.className = 'chat-name ' + (color === 'w' ? 'white' : 'black');
    const tag = color === myColor ? ' (you)' : !netMode && color === aiColor ? ' (AI)' : '';
    name.textContent = (color === 'w' ? 'White' : 'Black') + tag;
    const body = document.createElement('span');
    body.textContent = text; // player text: never innerHTML
    row.append(name, body);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  NetClient.onChat((msg) => {
    if (msg.type === 'chatHistory') {
      list.replaceChildren();
      msg.messages.forEach(add);
    } else {
      add(msg);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (netMode) NetClient.send({ type: 'chat', text });
    else if (aiColor) {
      add({ color: myColor, text });
      const bot = aiColor;
      setTimeout(() => {
        // Skip it if the vs-AI game ended meanwhile.
        if (aiColor === bot) add({ color: bot, text: BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)] });
      }, BOT_REPLY_MS);
    }
    else return;
    input.value = '';
  });

  function sync() {
    const canChat = (netMode && !!myColor) || (!netMode && !!aiColor);
    input.disabled = !canChat;
    form.querySelector('button').disabled = !canChat;
    input.placeholder = canChat ? 'Say something…' : netMode ? 'Spectators can only read' : 'Chat is for online and vs-AI games';
  }

  sync();
  // Called when a tab leaves an online game, so its lines don't carry over.
  function clear() { list.replaceChildren(); }
  return { sync, clear };
})();
