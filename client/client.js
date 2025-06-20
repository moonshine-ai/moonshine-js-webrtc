/* Moonshine WebRTC Translator Client
 *
 * (C) 2025 Moonshine AI, "Evan King" <evan@moonshine.ai>. Released under the
 * MIT License
 *
 * This client uses the Moonshine AI WebRTC library to establish a peer-to-peer
 * connection between two clients, allowing them to share video and audio
 * streams. It also uses the MoonshineJS Transcriber to transcribe the
 * audio stream in real-time and optionally translate it into another language
 * using a Hugging Face translation model.
 *
 * The client connects to a signaling server at wss://mm.moonshine.ai:423/
 * to exchange session keys and WebRTC offers/answers with another client.
 */

// Pulls in the MoonshineJS library to handle converting audio to text.
import * as Moonshine from "https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@develop/dist/moonshine.min.js";

// We use the Hugging Face Transformers library to run text to text translation
// models.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js";

//
// Page elements.
//
let localVideo,
    localVideoWrapper,
    remoteVideo,
    sessionKeyInput,
    startSessionEnglishBtn,
    startSessionSpanishBtn,
    joinSessionEnglishBtn,
    joinSessionSpanishBtn,
    currentCaption,
    infoText

//
// WebRTC connection and signaling server WebSocket settings.
//
let signalingServer;
const maxRetries = 5;
const retryInterval = 2000; // ms
let attempts = 0;

// The URL of the matchmaking server that allows clients to send messages to all
// other clients that share a session key. You're welcome to use this server at
// wss://mm.moonshine.ai:423/ for testing or prototyping, but for production
// use you should run your own instance of this server, since we make no
// guarantees about supporting external apps using this server. There are full
// instructions on how to run your own instance in the matchmaker/server.js
// file, and you can find that source code at
// https://github.com/moonshineai/moonshine-js-webrtc/tree/main/matchmaker/.
const socketUrl = "wss://mm.moonshine.ai:423/";
let clientId;

const peerConnection = new RTCPeerConnection();
let localLanguage = undefined;
let remoteLanguage = undefined;
let isConnecting;

//
// page elements
//
document.addEventListener("DOMContentLoaded", () => {
    localVideo = document.getElementById("localVideo");
    localVideoWrapper = document.getElementById("localVideoWrapper");
    remoteVideo = document.getElementById("remoteVideo");
    sessionKeyInput = document.getElementById("sessionKey");
    startSessionEnglishBtn = document.getElementById("startSessionEnglish");
    startSessionSpanishBtn = document.getElementById("startSessionSpanish");
    joinSessionEnglishBtn = document.getElementById("joinSessionEnglish");
    joinSessionSpanishBtn = document.getElementById("joinSessionSpanish");
    currentCaption = document.getElementById("currentCaption");
    infoText = document.getElementById("infoText");
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
    startSessionEnglishBtn.disabled = disabled;
    startSessionSpanishBtn.disabled = disabled;
    joinSessionEnglishBtn.disabled = disabled;
    joinSessionSpanishBtn.disabled = disabled;
}

// Generates a random session key of the specified length (default 16
// characters). This isn't intended to be cryptographically secure, but is
// sufficient for generating unique session keys for the purpose of this
// application. For more advanced use cases, see something like
// https://jsr.io/@alikia/random-key.
function getRandomSessionKey(length = 16) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }
    return `${window.location.origin.replace(/^https?:\/\//, "") +
        window.location.pathname
        }?meetingId=${result}`;
}

function isValidSessionKey(key) {
    return (
        key.length > 0 &&
        key.length <= 16 &&
        !/\s/.test(key) &&
        !/[!-/:-@[-`{-~]/.test(key)
    );
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
        document.getElementById(icon).classList.remove("d-none");
    } else {
        document.getElementById(icon).classList.add("d-none");
    }
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
            if (params.has("meetingId") && isValidSessionKey(params.get("meetingId"))) {
                log("Choose your language to join the meeting.");
            } else {
                log("Choose your language to create a new meeting.");
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

function sendMessage(type, ...payload) {
    signalingServer.send(
        JSON.stringify({
            type: type,
            key: getSessionKey(),
            clientId: clientId,
            ...Object.assign({}, ...payload),
        })
    );
}

//
// transcriber/translator loading and callbacks
//
let translator;
let transcriber;
let caption = "";
let captionTimeout;
let remoteStream;

function getFormattedCaption(text, maxChars, maxLines, commit = true) {
    if (caption.length + text.length >= maxChars * maxLines) {
        caption = "";
    }
    if (commit) {
        caption = `${caption} ${text}`;
        return caption;
    }
    return `${caption} <span class="update">${text}</mark>`;
}

function loadTranscriber(modelName) {
    let modelLoaded;
    let modelNotLoaded;
    const promise = new Promise((resolve, reject) => {
        modelLoaded = resolve;
        modelNotLoaded = reject;
    });

    // commit more frequently than default
    Moonshine.Settings.STREAM_COMMIT_INTERVAL = 16 * 4;

    transcriber = new Moonshine.Transcriber(
        modelName,
        {
            onError(error) {
                if (error === Moonshine.MoonshineError.PlatformUnsupported) {
                    modelNotLoaded();
                }
            },
            onModelLoadStarted() {
                console.log(`Loading Transcriber Moonshine ${modelName}`);
            },
            onModelLoaded() {
                console.log(`Transcriber Moonshine ${modelName} loaded.`);
                modelLoaded();
            },
            onSpeechStart() {
                // cancel the timeout to clear the caption after inactivity
                if (captionTimeout) {
                    clearTimeout(captionTimeout);
                }
            },
            onSpeechEnd() {
                // set a timeout to clear the caption after inactivity
                if (captionTimeout) {
                    clearTimeout(captionTimeout);
                }
                captionTimeout = setTimeout(() => {
                    caption = "";
                    currentCaption.innerHTML = "";
                }, 5000);
            },
            onTranscriptionUpdated(text) {
                if (text) {
                    if (translator) {
                        translator(text).then((result) => {
                            currentCaption.innerHTML = getFormattedCaption(
                                result[0].translation_text,
                                60,
                                2,
                                false
                            );
                        });
                    } else {
                        currentCaption.innerHTML = getFormattedCaption(
                            text,
                            60,
                            2,
                            false
                        );
                    }
                }
            },
            onTranscriptionCommitted(text) {
                if (text) {
                    if (translator) {
                        translator(text).then((result) => {
                            currentCaption.innerHTML = getFormattedCaption(
                                result[0].translation_text,
                                60,
                                2,
                                true
                            );
                        });
                    } else {
                        currentCaption.innerHTML = getFormattedCaption(
                            text,
                            60,
                            2,
                            true
                        );
                    }
                }
            },
        },
        false // streaming mode, which calls onTranscriptionUpdated periodically with speculative transcriptions.
    );
    transcriber.load();
    return promise;
}

function loadTranslator(modelName) {
    let modelLoaded;
    let modelNotLoaded;
    const promise = new Promise((resolve, reject) => {
        modelLoaded = resolve;
        modelNotLoaded = reject;
    });
    // load translator for remote language -> local language
    if (modelName) {
        console.log(`Loading translator ${modelName}.`);
        pipeline("translation", modelName).then((result) => {
            console.log(`Translator ${modelName} loaded.`);
            translator = result;
            modelLoaded();
        }).catch(() => {
            modelNotLoaded();
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
        ? ` and ${remoteLanguage} to ${localLanguage} translator...`
        : "...";
    log("Loading transcriber model" + endText);
    setVisibility("waitingIcon", false);
    setVisibility("loadingIcon", true);
    return await Promise.all([
        loadTranscriber(moonshineModelName),
        loadTranslator(translatorModelName),
    ]);
}

function startCall() {
    log("Starting call.");
    setVisibility("waitingIcon", false);
    setVisibility("loadingIcon", false);
    setVisibility("localVideoWrapper", true);
    transitionVideo(document.getElementById("localVideoWrapper"));

    remoteVideo.style.visibility = "visible";
    remoteVideo.style.opacity = "1";
    remoteVideo.srcObject = remoteStream;

    transcriber.attachStream(remoteStream);
    transcriber.start();
}

function endCall() {
    window.location.href =
        window.location.origin + window.location.pathname;
}

function getSessionKey() {
    return new URLSearchParams(sessionKeyInput.value.split("?")[1]).get("meetingId");
}

async function askThenJoinMeeting(language) {
    log("Awaiting microphone and webcam permissions.");
    setVisibility("waitingIcon", true);
    setVisibility("loadingIcon", false);
    navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
            stream
                .getTracks()
                .forEach((track) => peerConnection.addTrack(track, stream));
            localVideo.srcObject = stream;
            localVideo.classList.remove("d-none");
            joinMeeting(language);
        })
        .catch(() => {
            log("Permissions were denied. Please allow mic and camera access to start or join a call.");
            setVisibility("waitingIcon", false);
            setVisibility("loadingIcon", false);
        });

}

async function joinMeeting(language) {
    localLanguage = language;
    var key = getSessionKey();
    if (isValidSessionKey(key)) {
        // update the url with the new meeting id for easy sharing.
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('meetingId', key);
        window.history.replaceState({}, '', currentUrl.toString());
        if (peerConnection.signalingState === "stable") {
            log("Meeting created. Waiting for someone to join.");
            setVisibility("waitingIcon", true);
            setVisibility("copySession", true);
            disableControls(true);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendMessage("offer", {lang: language, offer})
        }
    } else {
        alert(
            "Invalid meeting key. Must have:\n- Between 1 and 16 characters\n- No spaces, punctuation, or special characters"
        );
    }
}

function init() {
    connect();

    peerConnection.ontrack = ({ streams }) => {
        if (!isConnecting) {
            console.log(remoteLanguage + " to " + localLanguage);
            isConnecting = true;

            const translatorModelName =
                remoteLanguage === localLanguage
                    ? undefined
                    : `Xenova/opus-mt-${remoteLanguage}-${localLanguage}`;

            // The Spanish speech to text Moonshine model is available under a community
            // license for researchers, developers, small businesses, and creators with
            // less than $1M in annual revenue. See https://moonshine.ai/license for details.
            const moonshineModelName =
                remoteLanguage === "en"
                    ? "model/tiny"
                    : "model/base-es-non-commercial";
            loadModels(moonshineModelName, translatorModelName).then(() => {
                log("Ready to go, waiting for other caller to load...");
                remoteStream = streams[0];
                sendMessage("ready");
            }).catch(() => {
                log("Sorry, this device or web browser is not supported.");
                setVisibility("waitingIcon", false);
                setVisibility("loadingIcon", false);
                setVisibility("localVideo", false);
                sendMessage("error", {text: "Cannot connect; peer is using an unsupported device or web browser."})
            });
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // log("Sending ICE candidate.")
            sendMessage("ice", {candidate: event.candidate})
        }
    };

    signalingServer.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "iceServers") {
            console.log("Received ICE servers for NAT traversal.");
            clientId = msg.clientId;
            peerConnection.setConfiguration({
                iceServers: msg.iceServers,
            });
        }
        if (msg.key !== getSessionKey()) return;
        if (msg.clientId === clientId) return;

        if (msg.type === "offer") {
            // log("Offer received.");
            remoteLanguage = msg.lang;
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(msg.offer)
            );
            // log("Sending answer.");
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            sendMessage("answer", {lang: localLanguage, answer})
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
        } else if (msg.type === "ready") {
            console.log("Received ready message from peer.");
            if (remoteStream) {
                startCall();
            } else {
                const readyInterval = setInterval(() => {
                    if (remoteStream) {
                        clearInterval(readyInterval);
                        startCall();
                    }
                }, 1000);
            }
        } else if (msg.type === "quit") {
            alert("Peer has left the call. Ending meeting.");
            endCall();
        } else if (msg.type === "error") {
            alert(msg.text)
            setVisibility("waitingIcon", false);
            setVisibility("loadingIcon", false);
            setVisibility("localVideo", false);
            endCall();
        }
    };

    startSessionEnglishBtn.onclick = function () { askThenJoinMeeting("en") };
    startSessionSpanishBtn.onclick = function () { askThenJoinMeeting("es") };
    joinSessionEnglishBtn.onclick = function () { askThenJoinMeeting("en") };
    joinSessionSpanishBtn.onclick = function () { askThenJoinMeeting("es") };

    //
    // draggable local video during calls
    //
    let offsetX = 0, offsetY = 0, isDragging = false;

    function startDrag(x, y) {
        isDragging = true;
        offsetX = x - localVideoWrapper.offsetLeft;
        offsetY = y - localVideoWrapper.offsetTop;
        localVideoWrapper.style.cursor = 'grabbing';
    }

    function dragMove(x, y) {
        if (!isDragging) return;
        localVideoWrapper.style.left = `${x - offsetX}px`;
        localVideoWrapper.style.top = `${y - offsetY}px`;
    }

    function endDrag() {
        isDragging = false;
        localVideoWrapper.style.cursor = 'grab';
    }

    // Mouse Events
    localVideoWrapper.addEventListener('mousedown', e => startDrag(e.clientX, e.clientY));
    document.addEventListener('mousemove', e => dragMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', endDrag);

    // Touch Events
    localVideoWrapper.addEventListener('touchstart', e => {
        const touch = e.touches[0];
        startDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const touch = e.touches[0];
        dragMove(touch.clientX, touch.clientY);
        e.preventDefault(); // Prevent scrolling
    }, { passive: false });

    document.addEventListener('touchend', endDrag);
}

//
// ui and signaling flow
//
document.addEventListener("DOMContentLoaded", () => {
    setVisibility("localVideoWrapper", false);
    // check if url includes session key
    if (params.has("meetingId") && isValidSessionKey(params.get("meetingId"))) {
        sessionKeyInput.value = `${window.location.origin.replace(/^https?:\/\//, "") +
            window.location.pathname
            }?meetingId=${params.get("meetingId")}`;
        setVisibility("joinSessionEnglish", true);
        setVisibility("joinSessionSpanish", true);
        setVisibility("startSessionEnglish", false);
        setVisibility("startSessionSpanish", false);
        setVisibility("copySession", false)
    } else {
        sessionKeyInput.value = getRandomSessionKey();
        setVisibility("joinSessionEnglish", false);
        setVisibility("joinSessionSpanish", false);
        setVisibility("startSessionEnglish", true);
        setVisibility("startSessionSpanish", true);
        setVisibility("copySession", false)
    }

    init();

    isConnecting = false;
});
