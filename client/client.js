import * as Moonshine from 'https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@latest/dist/moonshine.min.js'

const signalingServer = new WebSocket("wss://srv822706.hstgr.cloud:8080");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const sessionKeyInput = document.getElementById("sessionKey");
const languageInput = document.getElementById("languageSelect");
const startSessionBtn = document.getElementById("startSession");
const caption = document.getElementById("captions")

const peerConnection = new RTCPeerConnection();

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

const transcriber = new Moonshine.StreamTranscriber(
    "model/tiny",
    {
        onModelLoadStarted() {
            caption.innerHTML = "<i>Loading transcription model...</>"
        },
        onModelLoaded() {
            caption.innerHTML = ""
        },
        onTranscriptionUpdated(text) {
            caption.innerHTML = text
        }
    },
    true
)

peerConnection.ontrack = ({ streams }) => {
    if (!isConnected) {
        remoteVideo.style.visibility = 'visible'
        remoteVideo.style.opacity = '1'
        remoteVideo.srcObject = streams[0]

        transcriber.attachStream(streams[0])
        transcriber.start()

        console.log(remoteLanguage)

        isConnected = true
    }
};

peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
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
        remoteLanguage = msg.lang
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.offer)
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingServer.send(
            JSON.stringify({ type: "answer", key: msg.key, answer })
        );
    } else if (msg.type === "answer") {
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(msg.answer)
        );
    } else if (msg.type === "ice") {
        try {
            await peerConnection.addIceCandidate(msg.candidate);
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    }
};

startSessionBtn.onclick = async () => {
    if (peerConnection.signalingState === "stable") {
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
