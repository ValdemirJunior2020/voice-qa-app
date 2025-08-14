const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS + JSON
app.use(cors({ origin: true }));
app.use(express.json());

// uploads dir
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Health endpoints
app.get('/', (req, res) => res.status(200).send('OK'));
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// Multer: always save as voice.webm (browser records webm/opus on Chrome/Edge)
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, 'voice.webm')
});
const upload = multer({ storage });

// Simple rule-based QA scoring
function scoreTranscription(text) {
  const t = (text || '').toLowerCase();

  const checks = [
    { key: 'greeting',   test: /thank you for calling|good (morning|afternoon|evening)|hello|hi/ },
    { key: 'identity',   test: /(hotel reservations|reservation[s]?)/ },
    { key: 'assist',     test: /(how (may|can) i help|how may i assist)/ },
    { key: 'itinerary',  test: /(itinerary|confirmation|id|h\d{8,})/ },
    { key: 'verify',     test: /(name|check[- ]?in|check[- ]?out|hotel name)/ },
    { key: 'policy',     test: /(cancellation policy|refund policy|non-?refundable|terms)/ },
    { key: 'escalation', test: /(escalat(e|ion) team|supervisor|case|ticket)/ },
    { key: 'close',      test: /(anything else|is there anything else|have a (great|good) (day|night))/ }
  ];

  let hits = 0;
  const details = checks.map(c => {
    const pass = c.test.test(t);
    if (pass) hits++;
    return { item: c.key, pass };
  });

  const score = Math.round((hits / checks.length) * 100);
  return { score, details };
}

// Optional Gemini scoring
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
          generationConfig: { temperature: 0.2, maxOutputTokens: 400 }
        })
      }
    );

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch (e) {
    console.error('Gemini scoring failed:', e?.message || e);
    return null;
  }
}

// Upload + transcribe
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    const audioPath = path.join(UPLOAD_DIR, 'voice.webm');

    const PYTHON_EXEC = process.env.PYTHON_EXEC || 'python3';
    const py = spawn(
      PYTHON_EXEC,
      [path.join(__dirname, 'transcribe.py'), audioPath],
      {
        cwd: __dirname,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } // ensure UTF-8 prints
      }
    );

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', chunk => (stdoutData += chunk.toString()));
    py.stderr.on('data', chunk => (stderrData += chunk.toString()));

    py.on('close', async (code) => {
      if (code !== 0) {
        console.error('Python failed:', stderrData || 'Unknown error');
        return res.status(500).json({ error: 'Transcription failed', stderr: stderrData });
      }

      const transcription = (stdoutData || '').trim();
      const local = scoreTranscription(transcription);
      const ai = await geminiScore(transcription);

      res.json({
        transcription,
        score: ai?.score ?? local.score,
        details: ai?.reasons ?? local.details,
        meta: {
          usedGemini: Boolean(ai),
          stderrWarnings: stderrData?.trim() || null
        }
      });
    });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
