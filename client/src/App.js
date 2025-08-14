import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const API = process.env.REACT_APP_API || "http://localhost:5000";

export default function App() {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  async function startRecording() {
    try {
      setErr("");
      setResult(null);

      // Request mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const options = getSupportedMime();
      const mr = new MediaRecorder(stream, options);

      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = handleStop;

      mediaRecorderRef.current = mr;
      mr.start(); // start collecting data
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

  function getSupportedMime() {
    // Prefer webm/opus (Chrome/Edge). Fallback to default.
    const preferred = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    for (const type of preferred) {
      if (MediaRecorder.isTypeSupported(type)) return { mimeType: type, bitsPerSecond: 128000 };
    }
    return {}; // let the browser choose
  }

  async function handleStop() {
    try {
      setLoading(true);
      const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
      chunksRef.current = [];

      // Build form-data for server
      const form = new FormData();
      // server expects field name "audio"
      form.append("audio", blob, "voice.webm");

      const resp = await fetch(`${API}/upload`, {
        method: "POST",
        body: form,
      });

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

      <div className="record-box">
        <p>{recording ? "Recording…" : "Press Start and speak, then Stop."}</p>
        <div className="controls">
          {!recording ? (
            <button onClick={startRecording}>Start</button>
          ) : (
            <button onClick={stopRecording}>Stop</button>
          )}
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
              <summary>Whisper warnings</summary>
              <pre>{result.meta.stderrWarnings}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
