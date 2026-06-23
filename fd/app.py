"""
Mood Scanner — Face Emotion Detection web app
Backend: Flask + OpenCV (face detection) + DeepFace (emotion analysis)

This reuses the same detection approach as the original script
(Haar cascade for face boxes, DeepFace.analyze for emotion), just
wrapped in two HTTP endpoints instead of a cv2.imshow() loop:

  POST /api/detect-frame   -> for the live webcam stream (base64 JPEG)
  POST /api/detect-photo   -> for an uploaded photo (multipart file)
"""

import base64
import io

import cv2
import numpy as np
from deepface import DeepFace
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

# Keep emotion colors in sync with static/js/app.js EMOTION_COLORS
EMOTION_COLORS = {
    "happy": "#FFC857",
    "sad": "#5C8FE0",
    "angry": "#E0524C",
    "surprise": "#B57EDC",
    "fear": "#4FB8A8",
    "disgust": "#7FB069",
    "neutral": "#9AA0AE",
}

# Cap the longest edge before running detection — keeps DeepFace fast
# enough for near-real-time use on a CPU. Faces are still detected at
# this resolution and boxes are scaled back up before returning.
MAX_EDGE = 640


def _decode_base64_image(data_url: str) -> np.ndarray:
    """Turn a 'data:image/jpeg;base64,...' string into a BGR numpy frame."""
    header, encoded = data_url.split(",", 1)
    raw = base64.b64decode(encoded)
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _decode_upload_image(file_storage) -> np.ndarray:
    raw = file_storage.read()
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _resize_for_detection(frame: np.ndarray):
    h, w = frame.shape[:2]
    scale = 1.0
    longest = max(h, w)
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
    return frame, scale


def detect_emotions(frame: np.ndarray) -> list[dict]:
    """Find faces and analyze the dominant + per-class emotion for each.

    Returns boxes in the COORDINATE SPACE OF THE ORIGINAL `frame` passed
    in, even though detection internally runs on a downscaled copy.
    """
    small_frame, scale = _resize_for_detection(frame)
    gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.3, 5, minSize=(60, 60))

    results = []
    for (x, y, w, h) in faces:
        face_roi = small_frame[y:y + h, x:x + w]
        try:
            predictions = DeepFace.analyze(
                face_roi, actions=["emotion"], enforce_detection=False
            )
            pred = predictions[0]
            dominant = pred["dominant_emotion"]
            scores = {k: round(float(v), 1) for k, v in pred["emotion"].items()}
        except Exception:
            # No usable face in this crop — skip it rather than crash the request
            continue

        # Scale the box back to the original (full-resolution) frame
        inv = 1.0 / scale
        results.append({
            "x": round(x * inv),
            "y": round(y * inv),
            "w": round(w * inv),
            "h": round(h * inv),
            "dominant_emotion": dominant,
            "color": EMOTION_COLORS.get(dominant, "#9AA0AE"),
            "emotions": scores,
        })
    return results


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/detect-frame", methods=["POST"])
def detect_frame():
    payload = request.get_json(silent=True) or {}
    data_url = payload.get("image")
    if not data_url:
        return jsonify({"error": "missing 'image' field"}), 400

    frame = _decode_base64_image(data_url)
    if frame is None:
        return jsonify({"error": "could not decode image"}), 400

    h, w = frame.shape[:2]
    faces = detect_emotions(frame)
    return jsonify({"width": w, "height": h, "faces": faces})


@app.route("/api/detect-photo", methods=["POST"])
def detect_photo():
    if "photo" not in request.files:
        return jsonify({"error": "missing 'photo' file"}), 400

    frame = _decode_upload_image(request.files["photo"])
    if frame is None:
        return jsonify({"error": "could not decode image"}), 400

    h, w = frame.shape[:2]
    faces = detect_emotions(frame)
    return jsonify({"width": w, "height": h, "faces": faces})


if __name__ == "__main__":
    import os

    # host="0.0.0.0" so it's reachable from outside the container/machine.
    # Render (and most hosts) inject PORT — fall back to 5000 for local runs.
    port = int(os.environ.get("PORT", 5000))
    print("Mood Scanner starting...")
    print("First request will be slow while DeepFace downloads its model weights.")
    app.run(host="0.0.0.0", port=port, debug=True)
