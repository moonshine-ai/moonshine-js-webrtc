import { WebSocketExpress, Router } from 'websocket-express';

var app = new WebSocketExpress();
const router = new Router();
const port = process.env.PORT || 3000;

// Holds the matchmaking ids used to connect clients.
const sessions = new Map();

// app.use(function (req, res, next) {
//   console.log('middleware');
//   req.testing = 'testing';
//   return next();
// });

// app.get('/', function(req, res, next){
//   console.log('get route', req.testing);
//   res.send('Matchmaking server, websocket access only');
//   res.end();
// });

// app.ws('/', function(ws, req) {
//   ws.on('message', function(msg) {
//     console.log(msg);
//   });
//   console.log('socket', req.testing);
// });

router.ws('/', async (req, res) => {
  const ws = await res.accept();
  ws.on('message', (message) => {
    console.log('Received message:', message);
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
    console.log('WebSocket connection closed');
    for (const [key, clients] of sessions.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        sessions.delete(key);
      }
    }
  });
});

app.use(router);

app.listen(port, () => {
  console.log(`Matchmaker app listening on port ${port}`);
});