const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- CORS & JSON
app.use(cors({ origin: true }));
app.use(express.json());

// --- Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// --- Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'voice.wav'), // overwrite each time
});
const upload = multer({ storage });

// --- Simple transcription scorer (keyword/phrase hits)
function scoreTranscription(text) {
  const t = (text || '').toLowerCase();

  const checks = [
    { key: 'greeting', test: /thank you for calling|good (morning|afternoon|evening)|hello|hi/ },
    { key: 'identity', test: /(hotel reservations|reservation[s]?)/ },
    { key: 'assist', test: /(how (may|can) i help|how may i assist)/ },
    { key: 'itinerary', test: /(itinerary|id|confirmation|h\d{8,})/ },
    { key: 'verify', test: /(name|check[- ]?in|check[- ]?out|hotel name)/ },
    { key: 'policy', test: /(cancellation policy|refund policy|non-?refundable|terms)/ },
    { key: 'escalation', test: /(escalat(e|ion) team|supervisor|case|ticket)/ },
    { key: 'close', test: /(anything else|is there anything else|have a (great|good) (day|night))/ },
  ];

  let hits = 0;
  const detail = checks.map(c => {
    const pass = c.test.test(t);
    if (pass) hits += 1;
    return { item: c.key, pass };
  });

  // 8 checks → score out of 100
  const score = Math.round((hits / checks.length) * 100);

  return { score, details: detail };
}

// --- Optional Gemini scoring (only if GEMINI_API_KEY is set)
async function geminiScore(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `
Act as a QA evaluator for a hotel call center. Score the agent's performance 0-100 based on:
- Greeting and identity ("Hotel Reservations")
- Offer of help
- Verification (itinerary/ID, name, hotel, dates)
- Policy accuracy (refund/cancellation)
- Proper escalation (agent does not promise refunds)
- Closing

Return strict JSON: {"score": number, "reasons": string[]}
Transcription:
${text}
  `.trim();

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
        }),
      }
    );

    const data = await resp.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ??
      '';

    // Try to pull JSON from model output
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch (e) {
    console.error('Gemini scoring failed:', e.message);
    return null;
  }
}

// --- Upload + transcribe route
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });

    const audioPath = path.join(UPLOAD_DIR, 'voice.wav');

    // Allow PYTHON_EXEC override (e.g., "py -3" on Windows, or a venv path)
    const PYTHON_EXEC = process.env.PYTHON_EXEC || 'python';

    const py = spawn(PYTHON_EXEC, [path.join(__dirname, 'transcribe.py'), audioPath], {
      cwd: __dirname,
    });

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (chunk) => (stdoutData += chunk.toString()));
    py.stderr.on('data', (chunk) => (stderrData += chunk.toString()));

    py.on('close', async (code) => {
      // Whisper emits warnings to stderr even on success; only fail on non-zero code
      if (code !== 0) {
        console.error('Python failed:', stderrData || 'Unknown error');
        return res.status(500).json({ error: 'Transcription failed', stderr: stderrData });
      }

      const transcription = (stdoutData || '').trim();

      // Baseline local scoring
      const local = scoreTranscription(transcription);

      // Optional Gemini scoring
      const ai = await geminiScore(transcription);

      return res.json({
        transcription,
        score: ai?.score ?? local.score,
        details: ai?.reasons ?? local.details,
        meta: {
          usedGemini: Boolean(ai),
          stderrWarnings: stderrData?.trim() || null, // useful for debugging, can remove if you want
        },
      });
    });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
