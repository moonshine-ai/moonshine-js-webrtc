import * as Moonshine from "https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@latest/dist/moonshine.min.js";
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js";

//
// page elements
//
let localVideo,
    remoteVideo,
    sessionKeyInput,
    languageInput,
    startSessionBtn,
    lastCaption,
    currentCaption,
    infoText,
    langText;

//
// webrtc connection and signaling server websocket
//
const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.l.google.com:5349" },
        { urls: "stun:stun1.l.google.com:3478" },
        { urls: "stun:stun1.l.google.com:5349" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:5349" },
        { urls: "stun:stun3.l.google.com:3478" },
        { urls: "stun:stun3.l.google.com:5349" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:5349" },
        // TODO TURN service as alternative
    ],
};

let signalingServer;
const maxRetries = 5;
const retryInterval = 2000; // ms
const socketUrl = "wss://matchmaker.moonshine.ai/:423";
let attempts = 0;

const peerConnection = new RTCPeerConnection(rtcConfig);
let remoteLanguage = undefined;
let isConnecting;

//
// page elements
//
document.addEventListener("DOMContentLoaded", () => {
    localVideo = document.getElementById("localVideo");
    remoteVideo = document.getElementById("remoteVideo");
    sessionKeyInput = document.getElementById("sessionKey");
    languageInput = document.getElementById("languageSelect");
    startSessionBtn = document.getElementById("startSession");
    lastCaption = document.getElementById("lastCaption");
    currentCaption = document.getElementById("currentCaption");
    infoText = document.getElementById("infoText");
    langText = document.getElementById("langText");
});

//
// url params
//
const params = new URLSearchParams(window.location.search);

//
// helper functions
//
function log(text) {
    console.log(text);
    infoText.innerHTML = text;
}

function disableControls(disabled) {
    languageInput.disabled = disabled;
    startSessionBtn.disabled = disabled;

    // session key entry is locked when provided via URL
    if (!params.has("key")) sessionKeyInput.disabled = disabled;
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

function transitionVideo(toWrapper) {
    const first = localVideo.getBoundingClientRect();

    toWrapper.appendChild(localVideo);
    const last = localVideo.getBoundingClientRect();

    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const dw = first.width / last.width;
    const dh = first.height / last.height;

    localVideo.animate(
        [
            {
                transform: `translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`,
            },
            {
                transform: "none",
            },
        ],
        {
            duration: 500,
            easing: "ease",
        }
    );
}

function setVisibility(icon, visible) {
    if (visible) {
        document.getElementById(icon).style.display = "inline-block";
    } else {
        document.getElementById(icon).style.display = "none";
    }
}

function splitLine(text, min = 40, max = 60) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";

    for (let word of words) {
        const testLine = currentLine.length ? `${currentLine} ${word}` : word;

        if (testLine.length <= max) {
            currentLine = testLine;
        } else {
            if (currentLine.length >= min) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
                lines.push(currentLine);
                currentLine = "";
            }
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
}

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
            if (params.has("key")) {
                log("Choose your language, then press start to join.");
            } else {
                log(
                    "Choose your language, then begin a call by entering a shared session key."
                );
            }
        };

        signalingServer.onerror = (e) => {
            console.log(e);
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

//
// transcriber/translator loading
//
let translator;
let transcriber;
let caption = "";
let captions = [];

function loadTranscriber(modelName) {
    let modelLoaded;
    const promise = new Promise((resolve, reject) => {
        modelLoaded = resolve;
    });
    // spanish model is not on CDN - use different host
    if (modelName.includes("es")) {
        Moonshine.Settings.BASE_ASSET_PATH.MOONSHINE =
            "https://webrtc.moonshinejs.com/";
    }
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
                            caption = result[0].translation_text;
                            currentCaption.innerHTML =
                                splitLine(caption).join("<br>");
                        });
                    } else {
                        caption = text;
                        currentCaption.innerHTML =
                            splitLine(caption).join("<br>");
                    }
                }
            },
            onTranscriptionCommitted(text) {
                if (caption) {
                    captions.push(caption);
                    caption = "";
                    lastCaption.innerHTML = splitLine(
                        captions[captions.length - 1]
                    ).join("<br>");
                    currentCaption.innerHTML = "";
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
    setVisibility("waitingIcon", false);
    setVisibility("loadingIcon", true);
    return await Promise.all([
        loadTranscriber(moonshineModelName),
        loadTranslator(translatorModelName),
    ]);
}

function init() {
    connect();

    peerConnection.ontrack = ({ streams }) => {
        if (!isConnecting) {
            console.log(remoteLanguage + " to " + languageInput.value);
            isConnecting = true;

            const translatorModelName =
                remoteLanguage === languageInput.value
                    ? undefined
                    : `Xenova/opus-mt-${remoteLanguage}-${languageInput.value}`;
            const moonshineModelName =
                remoteLanguage === "en" ? "model/tiny" : "model/base-es";
            loadModels(moonshineModelName, translatorModelName).then(() => {
                log("Starting call.");
                setVisibility("waitingIcon", false);
                setVisibility("loadingIcon", false);
                transitionVideo(document.getElementById("localVideoWrapper"));

                remoteVideo.style.visibility = "visible";
                remoteVideo.style.opacity = "1";
                remoteVideo.srcObject = streams[0];

                transcriber.attachStream(streams[0]);
                transcriber.start();

                langText.textContent =
                    remoteLanguage + " → " + languageInput.value;
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
            // log("Offer received.");
            remoteLanguage = msg.lang;
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(msg.offer)
            );
            // log("Sending answer.");
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
            // log("Answer received.");
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
            log("Room created. Share the session key to start a call.");
            setVisibility("waitingIcon", true);
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
}

//
// ui and signaling flow
//
document.addEventListener("DOMContentLoaded", () => {
    init();

    // check if url includes session key
    if (params.has("key")) {
        sessionKeyInput.value = params.get("key");
        sessionKeyInput.disabled = true;
    } else {
        sessionKeyInput.value = getRandomSessionKey();
    }

    navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
            stream
                .getTracks()
                .forEach((track) => peerConnection.addTrack(track, stream));
            localVideo.srcObject = stream;
        });

    isConnecting = false;
});
