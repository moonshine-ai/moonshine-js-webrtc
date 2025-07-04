/* Moonshine Matchmaker Server
 *
 * (C) 2025 Moonshine AI, "Evan King" <evan@moonshine.ai> and "Pete Warden"
 * <pete@moonshine.ai>. Released under the MIT license.
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
 * wss://mm.moonshine.ai:423/ that you're welcome to use for testing, but we
 * recommend running your own instance for production use, since we make no
 * guarantees about supporting external apps using this server.
 *
 */
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');

const dotenv = require("dotenv");
dotenv.config();

const nmi = require('node-machine-id');

// Enable verbose logging if the MATCHMAKER_VERBOSE environment variable is set.
const verbose = process.env.MATCHMAKER_VERBOSE || false;
let machineId = "unknown";
if (verbose) {
    machineId = nmi.machineIdSync();
}
function log(...args) {
  if (verbose) {
    const timestamp = new Date().toISOString();
    const pid = process.pid || "unknown";
    console.log(machineId.slice(-6), timestamp, pid, ...args);
  }
}

// Only use SSL if the SSL_CERT and SSL_KEY environment variables are set.
let server;
if (process.env.SSL_CERT && process.env.SSL_KEY) {
    server = https.createServer({
        cert: fs.readFileSync(process.env.SSL_CERT),
        key: fs.readFileSync(process.env.SSL_KEY)
    });
} else {
    server = http.createServer();
}

const wss = new WebSocket.Server({ server });

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    // Using Twilio for NAT traversal (STUN/TURN) provides more reliability
    const twilio = require("twilio");

    twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
} else {
    console.log("No Twilio credentials provided, this needs to be implemented.");
    process.exit(1);
}

// Most VPS hosting services will set the PORT environment variable to the
// port they want you to run your app on, so we use that if it's set, otherwise
// we default to port 3000. This is especially important for running secure
// WebSocket connections (wss://) which require an https connection first, so
// we can't just assume port 80.
const port = process.env.PORT || 3000;
log(`Using port ${port}`);

// Maps session keys to sets of WebSocket connections, so a message sent by one
// client can be relayed to all other clients in the same session. In a more
// complex application, you might want to use a more sophisticated data store
// like Redis or a database to handle sessions, but for a simple matchmaker
// server, an in-memory Map is sufficient.
const sessions = new Map();

// A counter for assigning unique IDs to clients.
var clientId = 0;

const publicSTUNServers = [
    { urls: "stun:stun.l.google.com:19302" },
    // { urls: "stun:stun.l.google.com:5349" },
    // { urls: "stun:stun1.l.google.com:3478" },
    // { urls: "stun:stun1.l.google.com:5349" },
    // { urls: "stun:stun2.l.google.com:19302" },
    // { urls: "stun:stun2.l.google.com:5349" },
    // { urls: "stun:stun3.l.google.com:3478" },
    // { urls: "stun:stun3.l.google.com:5349" },
    // { urls: "stun:stun4.l.google.com:19302" },
    // { urls: "stun:stun4.l.google.com:5349" }
]

// Send a request to Twilio to get ICE servers for NAT traversal.
// This helps improve the reliability of the WebRTC connection by providing
// a fallback if the direct connection fails. You'll need to set the
// TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables to use this,
// or just leave it blank to use non-commercial servers.
async function getTwilioIceServers() {
    const token = await twilioClient.tokens.create();
    return token.iceServers.concat(publicSTUNServers);
}

function isValidSessionKey(key) {
    return (
        key.length > 0 &&
        key.length <= 16 &&
        !/\s/.test(key) &&
        !/[!-/:-@[-`{-~]/.test(key)
    );
}

// The entry point for WebSocket connections. Clients will connect to this
// endpoint and send messages to join a session or exchange data.
wss.on('connection', (ws) => {
    // Assign a unique ID to the client for logging purposes.
    ws.clientId = clientId;
    clientId++;
    log(ws.clientId, ': WebSocket connection accepted');

    // Send ICE servers to use for NAT traversal
    getTwilioIceServers().then((iceServers) => {
        log(ws.clientId, `: Sending ICE servers to client ${ws.clientId}`);
        ws.send(
            JSON.stringify({
                clientId: ws.clientId,
                type: "iceServers",
                iceServers: iceServers,
            })
        );
    });

    // Called when a new message is received from a client.
    ws.on("message", (message) => {
        let data;
        try {
            data = JSON.parse(message);
            log(ws.clientId, ': Parsed message data.');
        } catch (e) {
            console.error(ws.clientId, ": Invalid JSON:", message.toString().trim());
            return;
        }

        // The messages are expected to be in JSON format with at least a 'key'
        // string member. 'key' is the unique identifier for the session, and
        // determines which other clients should receive the message. The other
        // members of the message can be anything, and are relayed to other clients
        // in the same session untouched by this server.
        const { key } = data;
        if (!key) {
            log(ws.clientId, ': Message does not contain a key:', data);
            return;
        } else if (!isValidSessionKey(key)) {
            log(ws.clientId, `: Invalid session key: ${key}`);
            return;
        }

        // If this unique key does not exist in the sessions map, this must be the
        // first client to connect for this session, so we create a new Set that
        // holds this clients WebSocket connection information. If other clients
        // connect with the same key, they will be added to this Set, allowing them
        // to exchange messages with each other.
        if (!sessions.has(key)) {
            log(ws.clientId, `: Creating new session for key: ${key}, sessions: `, sessions);
            sessions.set(key, new Set());
        } else {
            log(ws.clientId, `: Adding client to existing session for key: ${key}`);
        }
        sessions.get(key).add(ws);
        log(ws.clientId, `: Session for key ${key} has ${sessions.get(key).size} clients`);

        // Iterate over all other clients that have registered their connections
        // with the same key identifier and rebroadcast the message to them.
        for (const client of sessions.get(key)) {
            if (client === ws) {
                log(ws.clientId, `: Skipping self`);
                continue;
            }
            if (client.readyState !== 1) { // 1 means OPEN
                log(ws.clientId, `: Client ${client.clientId} is not open (readyState: ${client.readyState}), skipping`);
                continue;
            }
            data.fromClientId = ws.clientId;
            data.toClientId = client.clientId;
            log(ws.clientId, `: Sending message type ${data.type} from client ${ws.clientId} to client ${client.clientId} in session ${key}`);
            client.send(JSON.stringify(data));
        }
    });

    ws.on("close", () => {
        log(ws.clientId, `: Client ${ws.clientId} closed connection`);
        // Look for any sessions that have this client in them and send quit messages
        // to all other clients in that session.
        for (const [key, clients] of sessions.entries()) {
            if (!clients.has(ws)) {
                continue;
            }
            clients.delete(ws);
            if (clients.size === 0) {
                log(ws.clientId, `: Deleting empty session ${key}`);
                sessions.delete(key);
            } else { // Notify peer that this peer has left the call.
                for (const client of clients) {
                    if (client !== ws && client.readyState === 1) {
                        log(ws.clientId, `: Sending quit message to client ${client.clientId} in session ${key}`);
                        client.send(
                            JSON.stringify({
                                type: "quit",
                                key: key,
                            })
                        );
                    }
                }
            }
        }
    });
});

server.listen(port, () => {
  console.log(`Matchmaking server running on port ${port}`);
});
