import * as Moonshine from "https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@latest/dist/moonshine.min.js";
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const sessionKeyInput = document.getElementById("sessionKey");
const languageInput = document.getElementById("languageSelect");
const startSessionBtn = document.getElementById("startSession");
const caption = document.getElementById("captions");
const infoText = document.getElementById("infoText");
const langText = document.getElementById("langText");

const peerConnection = new RTCPeerConnection();

let remoteLanguage = undefined;

function log(text) {
    console.log(text);
    infoText.innerHTML = text;
}

//
// connect to signaling server
//
const maxRetries = 5;
const retryInterval = 2000; // ms
const socketUrl = "wss://srv822706.hstgr.cloud:8080";
let attempts = 0;
let signalingServer;

function disableControls(disabled) {
    languageInput.disabled = disabled;
    sessionKeyInput.disabled = disabled;
    startSessionBtn.disabled = disabled;
}

function getRandomSessionKey(length = 16) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }
    return result;
}

sessionKeyInput.value = getRandomSessionKey();

function connect() {
    disableControls(true);

    if (attempts >= maxRetries) {
        log("Failed to connect after multiple attempts.");
        return;
    }

    attempts++;
    log(`Connecting to matchmaking server (${attempts}/${maxRetries})`);

    try {
        signalingServer = new WebSocket(socketUrl);

        signalingServer.onopen = () => {
            disableControls(false);
            log(
                "Choose your language, then begin a call by entering a shared session key."
            );
        };

        signalingServer.onerror = () => {
            log(`Attempt ${attempts} failed. Retrying...`);
            setTimeout(connect, retryInterval);
        };

        signalingServer.onclose = (event) => {
            if (!event.wasClean) {
                log(`Connection closed unexpectedly. Retrying...`);
                setTimeout(connect, retryInterval);
            }
        };
    } catch (e) {
        log(`Error: ${e.message}. Retrying...`);
        setTimeout(connect, retryInterval);
    }
}

connect();

navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .then((stream) => {
        stream
            .getTracks()
            .forEach((track) => peerConnection.addTrack(track, stream));
        localVideo.srcObject = stream;
    });

let translator;
let transcriber;

function loadTranscriber(modelName) {
    let modelLoaded;
    const promise = new Promise((resolve, reject) => {
        modelLoaded = resolve;
    });
    // load transcriber for remote language
    transcriber = new Moonshine.StreamTranscriber(
        modelName,
        {
            onModelLoadStarted() {
                console.log(`Loading Transcriber Moonshine ${modelName}`);
            },
            onModelLoaded() {
                console.log(`Transcriber Moonshine ${modelName} loaded.`);
                modelLoaded();
            },
            onTranscriptionUpdated(text) {
                if (text) {
                    if (translator) {
                        translator(text).then((result) => {
                            caption.innerHTML = result[0].translation_text;
                        });
                    } else {
                        caption.innerHTML = text;
                    }
                }
            },
        },
        false
    );
    transcriber.loadModel();
    return promise;
}

function loadTranslator(modelName) {
    let modelLoaded;
    const promise = new Promise((resolve, reject) => {
        modelLoaded = resolve;
    });
    // load translator for remote language -> local language
    if (modelName) {
        console.log(`Loading translator ${modelName}.`);
        pipeline("translation", modelName).then((result) => {
            console.log(`Translator ${modelName} loaded.`);
            translator = result;
            modelLoaded();
        });
    } else {
        console.log("No translator needed for same languages.");
        translator = undefined;
        modelLoaded();
    }
    return promise;
}

async function loadModels(moonshineModelName, translatorModelName) {
    const endText = translatorModelName
        ? ` and ${remoteLanguage} to ${languageInput.value} translator...`
        : "...";
    log("Loading transcriber model" + endText);
    return await Promise.all([
        loadTranscriber(moonshineModelName),
        loadTranslator(translatorModelName),
    ]);
}

var isConnecting = false;

peerConnection.ontrack = ({ streams }) => {
    if (!isConnecting) {
        console.log(`peerConnection.ontrack ${streams}`);
        console.log(remoteLanguage + " to " + languageInput.value);
        isConnecting = true;

        // TODO transcriber varies based on remoteLanguage
        const translatorModelName =
            remoteLanguage === languageInput.value
                ? undefined
                : `Xenova/opus-mt-${remoteLanguage}-${languageInput.value}`;
        loadModels("model/tiny", translatorModelName).then(() => {
            log("Starting call.");

            remoteVideo.style.visibility = "visible";
            remoteVideo.style.opacity = "1";
            remoteVideo.srcObject = streams[0];

            transcriber.attachStream(streams[0]);
            transcriber.start();

            langText.textContent = remoteLanguage + " → " + languageInput.value;
        });
    }
};

peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
        // log("Sending ICE candidate.")
        signalingServer.send(
            JSON.stringify({
                type: "ice",
                key: sessionKeyInput.value,
                candidate: event.candidate,
            })
        );
    }
};

signalingServer.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.key !== sessionKeyInput.value) return;

    if (msg.type === "offer") {
        log("Offer received.");
        remoteLanguage = msg.lang;
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.offer)
        );
        log("Sending answer.");
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingServer.send(
            JSON.stringify({
                type: "answer",
                key: msg.key,
                lang: languageInput.value,
                answer,
            })
        );
    } else if (msg.type === "answer") {
        log("Answer received.");
        remoteLanguage = msg.lang;
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.answer)
        );
    } else if (msg.type === "ice") {
        // log("ICE candidate received.");
        try {
            await peerConnection.addIceCandidate(msg.candidate);
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    }
};

startSessionBtn.onclick = async () => {
    if (peerConnection.signalingState === "stable") {
        log("Broadcasting offer to begin session.");
        disableControls(true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        signalingServer.send(
            JSON.stringify({
                type: "offer",
                key: sessionKeyInput.value,
                lang: languageInput.value,
                offer,
            })
        );
    }
};
