# Mood Scanner — Face Emotion Detection

A small Flask web app around your OpenCV + DeepFace emotion detector.
Friends can either turn on their webcam for live detection, or upload a
photo — both run through the same backend.

## 1. Install dependencies

```bash
cd face-emotion-app
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

DeepFace will download its emotion model weights the first time it runs
(a few hundred MB) — this only happens once and needs an internet
connection for that first request.

## 2. Run it

```bash
python app.py
```

You'll see something like:

```
Mood Scanner starting...
 * Running on http://0.0.0.0:5000
```

Open **http://localhost:5000** in your own browser to try it.

## 3. Share it with friends on the same Wi-Fi

1. Find your computer's local IP address:
   - Mac: `ipconfig getifaddr en0`
   - Windows: `ipconfig` (look for "IPv4 Address")
   - Linux: `hostname -I`
2. Make sure your firewall allows incoming connections on port 5000.
3. Send friends on the same network a link like `http://YOUR_LOCAL_IP:5000`.

This only works while your computer is on and friends are on the same
network (home Wi-Fi, same office, etc.) — it won't work over the open
internet without extra setup (a tunneling tool like ngrok, or deploying
to a server/cloud host).

## How it works

- `app.py` — Flask server. Same Haar-cascade + DeepFace logic as the
  original script, exposed as two JSON endpoints:
  - `POST /api/detect-frame` — used by the live webcam view, takes a
    base64 JPEG frame, returns face boxes + emotion scores.
  - `POST /api/detect-photo` — used by the upload view, takes an image
    file, returns the same shape of result.
- `templates/index.html` + `static/` — the frontend. The browser does
  the actual face capture (`getUserMedia`) or file handling, draws boxes
  on a `<canvas>` overlay using the coordinates the server returns, and
  shifts the page's accent color to match whichever emotion is currently
  winning.

## Notes

- Detection runs on the CPU by default; live mode polls roughly once a
  second so it stays responsive even on a laptop. If it feels slow, try
  closing other heavy apps, or lower `LIVE_CAPTURE_INTERVAL_MS` in
  `static/js/app.js` for snappier (but slower per-frame) updates — raise
  it if your machine struggles.
- Nothing is saved to disk — each frame/photo is analyzed in memory and
  discarded.
- For real, always-on public sharing, you'd want to deploy this behind a
  proper server (e.g. Render, Railway, or a VPS) rather than running it
  off your laptop — happy to help with that step too if you want it.
