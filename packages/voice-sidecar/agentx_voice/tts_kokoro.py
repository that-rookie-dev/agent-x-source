from __future__ import annotations

import base64
import re
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


class KokoroTts:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.pipeline = None

    def warm(self, request: dict[str, Any]) -> None:
        self._load()

    def unload(self) -> None:
        self.pipeline = None

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        output_path = request.get("outputPath")
        if not isinstance(output_path, str) or not output_path:
            tmp_dir = self.data_dir / "tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(tmp_dir / f"kokoro-{int(time.time() * 1000)}.wav")

        started = time.perf_counter()
        kokoro = self._load()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _map_voice_id(voice_id)

        try:
            import numpy as np
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError("numpy and soundfile are required for Kokoro synthesis.") from exc

        samples, sample_rate = kokoro.create(
            text, voice=kokoro_voice, speed=1.0, lang="en-us"
        )
        sf.write(output_path, samples, sample_rate)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "audioPath": output_path,
            "sampleRate": sample_rate,
            "durationMs": int(len(samples) / sample_rate * 1000),
            "timings": {"synthesizeMs": elapsed_ms},
        }

    def synthesize_stream(self, request: dict[str, Any], cancel_check: Callable[[], bool] | None = None) -> Iterator[dict[str, Any]]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        kokoro = self._load()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _map_voice_id(voice_id)

        for sentence in _split_sentences(text):
            if cancel_check and cancel_check():
                break
            samples, sample_rate = kokoro.create(
                sentence, voice=kokoro_voice, speed=1.0, lang="en-us"
            )
            pcm = _float_audio_to_pcm16(samples)
            yield {
                "pcmBase64": base64.b64encode(pcm).decode("ascii"),
                "sampleRate": sample_rate,
            }

    def _load(self):
        if self.pipeline is not None:
            return self.pipeline

        model_dir = self.data_dir / "models" / "tts" / "kokoro" / "kokoro-onnx"
        model_path = model_dir / "kokoro-v1.0.onnx"
        voices_path = model_dir / "voices-v1.0.bin"

        if not model_path.exists():
            raise FileNotFoundError("Kokoro ONNX model is not installed")
        if not voices_path.exists():
            raise FileNotFoundError(f"Kokoro voices file not found at {voices_path}")

        try:
            from kokoro_onnx import Kokoro
        except ImportError as exc:
            raise RuntimeError("kokoro-onnx is not installed. Install sidecar dependencies first.") from exc

        self.pipeline = Kokoro(str(model_path), str(voices_path))
        return self.pipeline


_KOKORO_VOICE_MAP = {
    # Legacy alias — keep for backward compatibility with existing configs
    "kokoro-af": "af_heart",
}


def _map_voice_id(voice_id: str) -> str:
    return _KOKORO_VOICE_MAP.get(voice_id, voice_id)


def _split_sentences(text: str) -> list[str]:
    parts = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    return parts or [text]


def _float_audio_to_pcm16(audio: Any) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    return pcm16.tobytes()
