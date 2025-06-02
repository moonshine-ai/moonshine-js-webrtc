import * as Moonshine from 'https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@latest/dist/moonshine.min.js'
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js';

const signalingServer = new WebSocket("wss://srv822706.hstgr.cloud:8080");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const sessionKeyInput = document.getElementById("sessionKey");
const languageInput = document.getElementById("languageSelect");
const startSessionBtn = document.getElementById("startSession");
const caption = document.getElementById("captions")
const infoText = document.getElementById("infoText")

const peerConnection = new RTCPeerConnection();

function log(text) {
    console.log(text)
    infoText.innerHTML = text
}

navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .then((stream) => {
        stream
            .getTracks()
            .forEach((track) =>
                peerConnection.addTrack(track, stream)
            );
        localVideo.srcObject = stream;
    });

var isConnected = false
let translator;
let transcriber;

peerConnection.ontrack = ({ streams }) => {
    if (!isConnected) {
        remoteVideo.style.visibility = 'visible'
        remoteVideo.style.opacity = '1'
        remoteVideo.srcObject = streams[0]

        // load translator for remote language -> local language
        if (languageInput.value != remoteLanguage) {
            pipeline('translation', `Xenova/opus-mt-${remoteLanguage}-${languageInput.value}`).then((result) => {
                console.log(`Translator Xenova/opus-mt-${remoteLanguage}-${languageInput.value} loaded.`)
                translator = result
            });
        } else {
            translator = undefined;
        }

        // load transcriber for remote language
        transcriber = new Moonshine.StreamTranscriber(
            "model/tiny", // TODO transcriber varies based on remoteLanguage
            {
                onModelLoadStarted() {
                    caption.innerHTML = "<i>Loading transcription model...</>"
                },
                onModelLoaded() {
                    caption.innerHTML = ""
                },
                onTranscriptionUpdated(text) {
                    if (translator) {
                        translator(text).then((result) => {
                            caption.innerHTML = result[0].translation_text
                        })
                    } else {
                        caption.innerHTML = text
                    }
                }
            },
            false
        )

        transcriber.attachStream(streams[0])
        transcriber.start()

        log("Starting call.")

        isConnected = true
    }
};

peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
        // log("Sending ICE candidate.")
        signalingServer.send(
            JSON.stringify({
                type: "ice",
                key: sessionKeyInput.value,
                lang: languageInput.value,
                candidate: event.candidate,
            })
        );
    }
};

let remoteLanguage = "en"

signalingServer.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.key !== sessionKeyInput.value) return;

    if (msg.type === "offer") {
        log("Offer received.")
        remoteLanguage = msg.lang
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.offer)
        );
        log("Sending answer.")
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingServer.send(
            JSON.stringify({ type: "answer", key: msg.key, answer })
        );
    } else if (msg.type === "answer") {
        log("Answer received.")
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.answer)
        );
    } else if (msg.type === "ice") {
        log("ICE candidate received.")
        try {
            await peerConnection.addIceCandidate(msg.candidate);
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    }
};

startSessionBtn.onclick = async () => {
    if (peerConnection.signalingState === "stable") {
        log("Sending offer to begin session.")
        languageInput.disabled = true
        sessionKeyInput.disabled = true
        startSessionBtn.disabled = true
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
