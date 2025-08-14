import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const API = process.env.REACT_APP_API || "http://localhost:5000";

function App() {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [mime, setMime] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  function getSupportedMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
  }

  async function startRecording() {
    try {
      setErr("");
      setResult(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = getSupportedMime();
      setMime(mimeType || "(browser default)");

      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType, bitsPerSecond: 128000 })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      mr.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = handleStop;

      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      setErr(`Mic error: ${e.message}`);
    }
  }

  function stopRecording() {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setRecording(false);
    } catch (e) {
      setErr(`Stop error: ${e.message}`);
    }
  }

  async function handleStop() {
    try {
      setLoading(true);
      const blob = new Blob(chunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || "audio/webm",
      });
      chunksRef.current = [];

      const form = new FormData();
      form.append("audio", blob, "voice.webm");

      const resp = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!resp.ok) {
        let e = {};
        try { e = await resp.json(); } catch {}
        throw new Error(e.error || `Upload failed (${resp.status})`);
      }
      const data = await resp.json();
      setResult(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <h1>Voice QA App</h1>

      <div className="card">
        <p className="small">Mime: {mime || "(not started)"}</p>
        <div className="controls">
          <button onClick={startRecording} disabled={recording}>Start</button>
          <button onClick={stopRecording} disabled={!recording}>Stop</button>
        </div>
      </div>

      {loading && <p>⏳ Processing…</p>}
      {err && <p className="error">⚠️ {err}</p>}

      {result && (
        <div className="result">
          <h2>📝 Transcription</h2>
          <pre>{result.transcription || "(empty)"}</pre>

          <h2>📊 Score: {result.score}</h2>
          {Array.isArray(result.details) ? (
            <ul>
              {result.details.map((d, i) =>
                typeof d === "string" ? (
                  <li key={i}>{d}</li>
                ) : (
                  <li key={i}>
                    {d.item}: {d.pass ? "✅" : "❌"}
                  </li>
                )
              )}
            </ul>
          ) : null}

          {result.meta?.stderrWarnings && (
            <details>
              <summary>Transcriber warnings</summary>
              <pre>{result.meta.stderrWarnings}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
