from __future__ import annotations

from pathlib import Path
from typing import Any


class SileroVad:
    def __init__(self, data_dir: str = "") -> None:
        self.data_dir = Path(data_dir) if data_dir else None
        self.model = None
        self.threshold = 0.5

    def warm(self, request: dict[str, Any]) -> None:
        self.threshold = float(request.get("threshold", 0.5))
        try:
            import torch
            model, utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
            )
            self.model = model
        except Exception:
            # Fallback to energy-based VAD when Silero is unavailable.
            self.model = None

    def detect(self, request: dict[str, Any]) -> dict[str, Any]:
        pcm = request.get("pcm")
        sample_rate = int(request.get("sampleRate", 16000))
        if not isinstance(pcm, (bytes, bytearray)):
            raise ValueError("pcm bytes are required")

        if self.model is not None:
            try:
                import torch
                audio = torch.frombuffer(bytearray(pcm), dtype=torch.int16).float() / 32768.0
                if sample_rate != 16000:
                    # Silero expects 16k; coarse resample by stride for endpointing only.
                    step = max(1, sample_rate // 16000)
                    audio = audio[::step]
                speech_prob = float(self.model(audio, 16000).item())
                is_speech = speech_prob >= self.threshold
                return {
                    "isSpeech": is_speech,
                    "confidence": speech_prob,
                    "speechStartMs": 0 if is_speech else None,
                    "speechEndMs": None if is_speech else 0,
                }
            except Exception:
                pass

        # Energy fallback
        import array
        samples = array.array("h")
        samples.frombytes(bytes(pcm))
        if not samples:
            return {"isSpeech": False, "confidence": 0.0}
        energy = sum(abs(s) for s in samples) / len(samples) / 32768.0
        is_speech = energy > 0.02
        return {
            "isSpeech": is_speech,
            "confidence": min(1.0, energy * 10),
            "speechStartMs": 0 if is_speech else None,
            "speechEndMs": None if is_speech else 0,
        }
