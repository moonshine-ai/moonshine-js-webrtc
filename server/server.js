const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');

const PORT = 8080;

const server = https.createServer({
  cert: fs.readFileSync('/certs/fullchain1.pem'),
  key: fs.readFileSync('/certs/privkey1.pem')
});

const wss = new WebSocket.Server({ server });

const sessions = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
      console.log(data)
    } catch (e) {
      console.error('Invalid JSON:', message);
      return;
    }

    const { key, type } = data;
    if (!key) return;

    // Join session room
    if (!sessions.has(key)) {
      sessions.set(key, new Set());
    }
    sessions.get(key).add(ws);

    // Relay the message to other peers in the same session
    for (const client of sessions.get(key)) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    }
  });

  ws.on('close', () => {
    for (const [key, clients] of sessions.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        sessions.delete(key);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
