// Keep in sync with EMOTION_COLORS in app.py
const EMOTION_COLORS = {
  happy: "#FFC857",
  sad: "#5C8FE0",
  angry: "#E0524C",
  surprise: "#B57EDC",
  fear: "#4FB8A8",
  disgust: "#7FB069",
  neutral: "#9AA0AE",
};

const LIVE_CAPTURE_INTERVAL_MS = 900;

// ---------- shared helpers ----------

function setAccent(emotion) {
  const color = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-soft", color + "33");
}

function renderBars(emotions) {
  const container = document.getElementById("emotionBars");
  const order = ["happy", "neutral", "sad", "surprise", "angry", "fear", "disgust"];
  const entries = order
    .filter((k) => k in emotions)
    .map((k) => [k, emotions[k]]);

  container.innerHTML = entries
    .map(([name, value]) => {
      const color = EMOTION_COLORS[name] || EMOTION_COLORS.neutral;
      return `
        <div class="bar-row">
          <span class="bar-name">${name}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${value}%; background:${color}"></div>
          </div>
          <span class="bar-value">${value.toFixed(0)}%</span>
        </div>`;
    })
    .join("");
}

function clearBars() {
  document.getElementById("emotionBars").innerHTML =
    '<p class="bar-name" style="opacity:.6">Nothing to show yet</p>';
}

function updateReadout(faces) {
  const emotionEl = document.getElementById("dominantEmotion");
  const countEl = document.getElementById("faceCount");

  if (!faces || faces.length === 0) {
    emotionEl.textContent = "—";
    countEl.textContent = "No face detected yet";
    setAccent("neutral");
    clearBars();
    return;
  }

  const primary = faces[0];
  emotionEl.textContent = primary.dominant_emotion;
  countEl.textContent =
    faces.length === 1 ? "1 face detected" : `${faces.length} faces detected`;
  setAccent(primary.dominant_emotion);
  renderBars(primary.emotions);
}

function drawBoxes(ctx, canvas, faces, mirror = false) {
  faces.forEach((f) => {
    const x = mirror ? canvas.width - f.x - f.w : f.x;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, f.y, f.w, f.h);

    const label = f.dominant_emotion.toUpperCase();
    ctx.font = "600 16px 'Space Grotesk', sans-serif";
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = f.color;
    ctx.fillRect(x, f.y - 26, textWidth + 16, 24);
    ctx.fillStyle = "#14141c";
    ctx.fillText(label, x + 8, f.y - 8);
  });
}

// ---------- mode switching ----------

const modeButtons = document.querySelectorAll(".mode-btn");
const liveView = document.getElementById("liveView");
const uploadView = document.getElementById("uploadView");

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    const mode = btn.dataset.mode;
    liveView.classList.toggle("is-active", mode === "live");
    uploadView.classList.toggle("is-active", mode === "upload");

    if (mode === "upload") {
      stopCamera();
    }
    updateReadout([]);
  });
});

// ---------- live camera ----------

const video = document.getElementById("video");
const liveOverlay = document.getElementById("liveOverlay");
const liveOverlayCtx = liveOverlay.getContext("2d");
const liveEmptyState = document.getElementById("liveEmptyState");
const startCameraBtn = document.getElementById("startCameraBtn");
const liveHint = document.getElementById("liveHint");

let captureCanvas = document.createElement("canvas");
let captureCtx = captureCanvas.getContext("2d");
let liveStream = null;
let liveTimer = null;
let liveRequestInFlight = false;

async function startCamera() {
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = liveStream;
    liveEmptyState.hidden = true;
    liveHint.textContent = "Scanning… hold still for a clearer reading.";

    video.addEventListener("loadedmetadata", () => {
      liveOverlay.width = video.videoWidth;
      liveOverlay.height = video.videoHeight;
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
    });

    liveTimer = setInterval(captureAndAnalyzeFrame, LIVE_CAPTURE_INTERVAL_MS);
  } catch (err) {
    liveHint.textContent =
      "Couldn't access the camera. Check your browser's permissions and try again.";
  }
}

function stopCamera() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  if (liveStream) {
    liveStream.getTracks().forEach((t) => t.stop());
    liveStream = null;
  }
  video.srcObject = null;
  liveEmptyState.hidden = false;
  liveOverlayCtx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);
  liveHint.textContent = "Allow camera access to start scanning.";
}

async function captureAndAnalyzeFrame() {
  if (liveRequestInFlight || !video.videoWidth) return;
  liveRequestInFlight = true;

  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.7);

  try {
    const res = await fetch("/api/detect-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const data = await res.json();
    if (data.faces) {
      // video is mirrored via CSS for a natural selfie view, so mirror the boxes too
      liveOverlayCtx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);
      drawBoxes(liveOverlayCtx, liveOverlay, data.faces, true);
      updateReadout(data.faces);
    }
  } catch (err) {
    // a dropped frame isn't worth interrupting the user over; just try again next tick
  } finally {
    liveRequestInFlight = false;
  }
}

startCameraBtn.addEventListener("click", startCamera);

// ---------- photo upload ----------

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploadCanvas = document.getElementById("uploadCanvas");
const uploadCtx = uploadCanvas.getContext("2d");
const uploadHint = document.getElementById("uploadHint");

dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
  if (e.dataTransfer.files[0]) handlePhotoFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handlePhotoFile(fileInput.files[0]);
});

function handlePhotoFile(file) {
  if (!file.type.startsWith("image/")) {
    uploadHint.textContent = "That doesn't look like an image — try a JPG or PNG.";
    return;
  }

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);

  img.onload = async () => {
    uploadCanvas.width = img.naturalWidth;
    uploadCanvas.height = img.naturalHeight;
    uploadCtx.drawImage(img, 0, 0);
    dropzone.hidden = true;
    uploadCanvas.hidden = false;
    uploadHint.textContent = "Analyzing…";
    URL.revokeObjectURL(objectUrl);

    const formData = new FormData();
    formData.append("photo", file);

    try {
      const res = await fetch("/api/detect-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.faces) {
        // redraw the photo (drawBoxes no longer clears the canvas), then boxes on top
        uploadCtx.drawImage(img, 0, 0);
        drawBoxes(uploadCtx, uploadCanvas, data.faces, false);

        updateReadout(data.faces);
        uploadHint.textContent =
          data.faces.length === 0
            ? "No face found in that photo — try a clearer, front-facing shot."
            : "Done. Drop another photo to scan again.";
      }
    } catch (err) {
      uploadHint.textContent = "Something went wrong reaching the server. Try again.";
    }
  };

  img.src = objectUrl;
}

// initial state
updateReadout([]);
