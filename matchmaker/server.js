/* Moonshine Matchmaker Server
 *
 * (C) 2025 Moonshine AI, "Evan King" <evan@moonshine.ai> and "Pete Warden"
 * <pete@moonshine.ai>. Released under the Apache License, Version 2.0
 *
 * This server handles WebSocket connections for matchmaking webrtc clients. It
 * allows clients to connect, find peers, and exchange messages based on a
 * unique key. 
 * 
 * The canonical source for this code is at
 * https://github.com/moonshineai/moonshine-js-webrtc where you can find more
 * information about the whole Moonshine AI WebRTC system. This `matchmaker`
 * folder contains this script, and a dockerfile to install and start the
 * server. You should be able to run this server on any hosting service that
 * supports VPS, such as Digital Ocean's App Platform, AWS, or any other service
 * that allows you to create server instances from dockerfiles.
 * 
 * To run it locally, first install the dependencies with `npm install`, then
 * start the server with `node server.js`. You can test that it's working by
 * using the websocat (https://github.com/vi/websocat) command line tool to
 * connect to the server and send messages:
 *
 * echo '{"key":"foo", "payload":"bar"}' | websocat ws://localhost:3000/ -v
 * 
 * The basic flow is:
 * 1. Client A connects to the server via a websocket.
 * 2. Client A sends a message with a unique key, defining the "room name" of
 *    the meeting.
 * 3. The server stores the websocket connection in a Map with the key as the
 *    identifier.
 * 4. The user behind Client A can now share the key with Client B through any
 *    means (e.g., email, chat, SMS).
 * 5. Client B connects to the server via websocket and sends key ("room name")
 *    it has been given.
 * 6. The server finds the existing connection for that key and sends the
 *    message received from Client B to client A.
 * 7. Client A and Client B can now exchange messages by sending further
 *    messages using their websocket connections and this server will route
 *    those messages to the other client's websocket connection.
 *
 * This server is intended to be used with the Moonshine AI WebRTC client
 * library, which handles the actual WebRTC connection setup and media
 * streaming. It is not intended to handle any media streaming itself. It is
 * agnostic to the content of the messages though, and so in theory could be
 * used to broadcast any kind of data between clients that share a key.
 * 
 * There should be an instance of this server running at
 * wss://matchmaker.moonshine.ai that you're welcome to use for testing, but we
 * recommend running your own instance for production use, since we make no
 * guarantees about supporting external apps using this server. 
 * 
*/

// Using websocket-express instead of the more widespread express-ws because
// I was running into issues with express-ws that I couldn't resolve.
import { WebSocketExpress, Router } from 'websocket-express';

var app = new WebSocketExpress();
const router = new Router();

// Most VPS hosting services will set the PORT environment variable to the
// port they want you to run your app on, so we use that if it's set, otherwise
// we default to port 3000. This is especially important for running secure
// WebSocket connections (wss://) which require an https connection first, so 
// we can't just assume port 80.
const port = process.env.PORT || 3000;

// Maps session keys to sets of WebSocket connections, so a message sent by one
// client can be relayed to all other clients in the same session. In a more
// complex application, you might want to use a more sophisticated data store
// like Redis or a database to handle sessions, but for a simple matchmaker
// server, an in-memory Map is sufficient.
const sessions = new Map();

// The entry point for WebSocket connections. Clients will connect to this
// endpoint and send messages to join a session or exchange data.
router.ws('/', async (req, res) => {
  const ws = await res.accept();

  // Called when a new message is received from a client.
  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error('Invalid JSON:', message);
      return;
    }

    // The messages are expected to be in JSON format with at least a 'key'
    // string member. 'key' is the unique identifier for the session, and
    // determines which other clients should receive the message. The other
    // members of the message can be anything, and are relayed to other clients
    // in the same session untouched by this server.
    const { key } = data;
    if (!key) return;

    // If this unique key does not exist in the sessions map, this must be the
    // first client to connect for this session, so we create a new Set that
    // holds this clients WebSocket connection information. If other clients
    // connect with the same key, they will be added to this Set, allowing them
    // to exchange messages with each other.
    if (!sessions.has(key)) {
      sessions.set(key, new Set());
    }
    sessions.get(key).add(ws);

    // Iterate over all other clients that have registered their connections
    // with the same key identifier and rebroadcast the message to them.
    for (const client of sessions.get(key)) {
      if (client !== ws && client.readyState === 1) { // 1 means OPEN
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

app.use(router);

app.listen(port, () => {
  console.log(`Matchmaker app listening on port ${port}`);
});