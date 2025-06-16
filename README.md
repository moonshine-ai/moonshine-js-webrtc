# MoonshineJS + WebRTC

Video calling with real-time, on-device transcription and translation. From [Moonshine AI](https://moonshine.ai/), see a live demo at
[webrtc.moonshine.ai](https://webrtc.moonshine.ai).

<!-- toc -->

-   [Introduction](#introduction)
-   [Running the Client](#running-the-client)
-   [Running the Matchmaker](#running-the-matchmaker)
-   [License](#license)

<!-- tocstop -->

## Introduction

This repo hosts a demo of peer-to-peer WebRTC video calling with live, on-device
transcription and translation using [MoonshineJS](https://dev.moonshine.ai/#js).
It includes two key components:

-   `client`: the app frontend, demonstrating the (super simple) use of
    MoonshineJS for transcribing the audio stream received over WebRTC.
-   `matchmaker`: a simple WebRTC pairing server, allowing two clients to form a
    peer-to-peer connection by sharing a session key.

The only data received by the server is a handshake for connecting clients. All
audio processing happens locally in the user's browser!

## Running the Client

The complete client implementation is inside the `client` folder, and can be
statically hosted. The easiest way to try it locally is running this command
from the root of the repository:

```bash
npx vite
```

This exposes the contents of `client` as static files. If you navigate to
[localhost:5173](http://localhost:5173/) you should see the starting page where
you can initiate a video call.

For production we use a Google Cloud bucket, so deployment is as simple as

```bash
gsutil cp -a publicRead client/* gs://webrtc.moonshine.ai/
```

## Running the Matchmaker

WebRTC is peer to peer, but for one client to connect to another based on a
meeting ID we need a service that broadcasts messages from one client to another
based on that ID. The matchmaker script provides that service, but since there's
state involved it can't be hosted statically.

Instead the
[matchmaker/server.js](https://github.com/moonshine-ai/moonshine-js-webrtc/matchmaker/server.js)
needs to be running somewhere. By default the
[client/client.js](https://github.com/moonshine-ai/moonshine-js-webrtc/client/client.js)
script uses the server run by Moonshine AI at `wss://matchmaker.moonshine.ai/`
which is fine for testing or prototyping purposes, but you'll want to host your
own in a production environment, since we can't offer availability guarantees
for ours.

The matchmaker code is designed to run straightforwardly on VPS services like
Digital Ocean's App platform. The [server
script](https://github.com/moonshine-ai/moonshine-js-webrtc/matchmaker/server.js)
contains extensive documentation on how it works internally. If you want to run
it locally, you should be able to with these commands:

```bash
cd matchmaker
npm install
node server.js
```

You should see a log message like `Matchmaker app listening on port 3000`. To
test it is working, run this [websocat](https://github.com/vi/websocat) command
in another terminal:

```bash
echo '{"key":"foo", "payload":"bar"}' | websocat ws://localhost:3000/ -v
```

## License

This code and the English-language Moonshine speech to text model it uses are
released under the Apache License, Version 2.0, see LICENSE in this folder.

The Spanish-language speech to text model is released under the [Moonshine AI
Community License](https://moonshine.ai/license) for researchers, developers,
small businesses, and creators with less than $1M in annual revenue.

We're grateful to the team behind [HuggingFace
TransformersJS](https://huggingface.co/docs/transformers.js/en/index) for the
library that allows us to run the translation component of this demo, and the
[Helsinki NLP group](https://huggingface.co/Helsinki-NLP) for their Spanish to
English and English to Spanish test-to-text translation
models.
