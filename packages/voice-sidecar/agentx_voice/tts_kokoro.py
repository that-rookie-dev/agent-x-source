from __future__ import annotations

import base64
import re
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


KOKORO_REPO_ID = "hexgrad/Kokoro-82M"


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
        pipeline = self._load()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _map_voice_id(voice_id)

        # If the requested voice isn't loaded locally, fall back to the default
        # instead of letting the pipeline try to download it from HuggingFace.
        if kokoro_voice not in pipeline.voices:
            kokoro_voice = "af_heart"

        try:
            import numpy as np
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError("numpy and soundfile are required for Kokoro synthesis.") from exc

        chunks = []
        for _, _, audio in pipeline(text, voice=kokoro_voice):
            chunks.append(audio)
        if not chunks:
            raise RuntimeError("Kokoro produced no audio")

        audio = np.concatenate(chunks)
        sample_rate = 24_000
        sf.write(output_path, audio, sample_rate)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "audioPath": output_path,
            "sampleRate": sample_rate,
            "durationMs": int(len(audio) / sample_rate * 1000),
            "timings": {"synthesizeMs": elapsed_ms},
        }

    def synthesize_stream(self, request: dict[str, Any], cancel_check: Callable[[], bool] | None = None) -> Iterator[dict[str, Any]]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        pipeline = self._load()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _map_voice_id(voice_id)
        # Fall back to default voice if the requested one isn't loaded locally.
        if kokoro_voice not in pipeline.voices:
            kokoro_voice = "af_heart"
        sample_rate = 24_000

        try:
            import numpy as np
        except ImportError as exc:
            raise RuntimeError("numpy is required for Kokoro synthesis.") from exc

        for sentence in _split_sentences(text):
            if cancel_check and cancel_check():
                break
            chunks = []
            for _, _, audio in pipeline(sentence, voice=kokoro_voice):
                chunks.append(audio)
            if not chunks:
                continue
            audio = np.concatenate(chunks)
            pcm = _float_audio_to_pcm16(audio)
            yield {
                "pcmBase64": base64.b64encode(pcm).decode("ascii"),
                "sampleRate": sample_rate,
            }

    def _load(self):
        if self.pipeline is not None:
            return self.pipeline

        model_dir = self.data_dir / "models" / "tts" / "kokoro" / "kokoro-82m"
        if not model_dir.exists():
            raise FileNotFoundError("Kokoro model is not installed")

        config_path = model_dir / "config.json"
        if not config_path.exists():
            raise FileNotFoundError(f"Kokoro config not found at {config_path}")

        weight_path = model_dir / "kokoro-v1_0.pth"
        if not weight_path.exists():
            pth_files = sorted(model_dir.glob("*.pth"))
            if not pth_files:
                raise FileNotFoundError(f"Kokoro weights not found in {model_dir}")
            weight_path = pth_files[0]

        try:
            import torch
            from kokoro import KModel, KPipeline
        except ImportError as exc:
            raise RuntimeError("Kokoro is not installed. Install sidecar dependencies first.") from exc

        device = "cuda" if torch.cuda.is_available() else "cpu"
        km = KModel(
            repo_id=KOKORO_REPO_ID,
            config=str(config_path),
            model=str(weight_path),
        ).to(device).eval()

        # repo_id=None prevents HuggingFace lookups — weights and voices are local.
        pipeline = KPipeline(lang_code="a", repo_id=None, model=km)

        voices_dir = model_dir / "voices"
        if voices_dir.is_dir():
            for voice_file in voices_dir.glob("*.pt"):
                pipeline.voices[voice_file.stem] = torch.load(
                    str(voice_file), weights_only=True
                )

        self.pipeline = pipeline
        return self.pipeline


def _map_voice_id(voice_id: str) -> str:
    if voice_id == "kokoro-af":
        return "af_heart"
    return voice_id


def _split_sentences(text: str) -> list[str]:
    parts = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    return parts or [text]


def _float_audio_to_pcm16(audio: Any) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    return pcm16.tobytes()
