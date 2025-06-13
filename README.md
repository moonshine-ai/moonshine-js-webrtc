# MoonshineJS + WebRTC

[webrtc.moonshinejs.com](https://webrtc.moonshinejs.com)

This repo hosts a demo of peer-to-peer WebRTC video calling with live, on-device transcription and translation using MoonshineJS. It includes two key components:

-   `client`: the app frontend, demonstrating the (super simple) use of MoonshineJS for transcribing the audio stream received over WebRTC.
-   `server`: a simple WebRTC pairing server, allowing two clients to form a peer-to-peer connection by sharing a session key.

The only data received by the server is a handshake for connecting clients. All audio processing happens locally in the user's browser!

## Running it yourself

The simplest way to get started is by using our existing server at `rtcserver.moonshine.ai`.