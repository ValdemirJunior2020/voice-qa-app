import sys
import warnings
import whisper

if len(sys.argv) < 2:
    print("Usage: python transcribe.py <audio_path>")
    sys.exit(1)

audio_path = sys.argv[1]

# Silence the noisy FP16-on-CPU warning
warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")

try:
    # For CPU, tiny/base are much faster; pick what you want: "tiny" | "base" | "small"
    model = whisper.load_model("tiny")  # change to "base" if you prefer
    # fp16=False to avoid FP16 behavior entirely on CPU
    result = model.transcribe(audio_path, fp16=False)
    print(result.get("text", "").strip())
except Exception as e:
    print(f"Error during transcription: {e}", file=sys.stderr)
    sys.exit(1)
