import sys
import unicodedata
from faster_whisper import WhisperModel

# --- Force UTF-8 stdout/stderr to avoid charmap errors on Windows/consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

if len(sys.argv) < 2:
    print("Usage: python transcribe.py <audio_path>")
    sys.exit(1)

audio_path = sys.argv[1]

# tiny/base are best for CPU. int8 is fast and accurate enough for QA.
model = WhisperModel("tiny", compute_type="int8")

# VAD improves quality by trimming silence/noise
segments, info = model.transcribe(audio_path, vad_filter=True)

text = "".join(seg.text for seg in segments).strip()
text = unicodedata.normalize("NFKC", text)  # normalize exotic unicode just in case
print(text)
