from __future__ import annotations

from pathlib import Path
from typing import Any

# Silero VAD expects exactly 512 samples (32ms @ 16kHz) per inference call.
_SILERO_FRAME_SIZE = 512
# Number of consecutive speech frames to trigger isSpeech=True (debounce).
_SPEECH_FRAMES_MIN = 2
# Number of consecutive silence frames to trigger isSpeech=False (debounce).
_SILENCE_FRAMES_MIN = 8


class SileroVad:
    def __init__(self, data_dir: str = "") -> None:
        self.data_dir = Path(data_dir) if data_dir else None
        self.model = None
        self.threshold = 0.5
        self._speech_frame_count = 0
        self._silence_frame_count = 0
        self._current_is_speech = False

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
            self.reset_states()
        except Exception:
            # Fallback to energy-based VAD when Silero is unavailable.
            self.model = None

    def reset_states(self) -> None:
        """Reset the VAD model's internal state — call at the start of each turn."""
        if self.model is not None:
            try:
                self.model.reset_states()
            except Exception:
                pass
        self._speech_frame_count = 0
        self._silence_frame_count = 0
        self._current_is_speech = False

    def detect(self, request: dict[str, Any]) -> dict[str, Any]:
        pcm = request.get("pcm")
        sample_rate = int(request.get("sampleRate", 16000))
        if not isinstance(pcm, (bytes, bytearray)):
            raise ValueError("pcm bytes are required")

        if request.get("reset"):
            self.reset_states()

        if self.model is not None:
            try:
                import torch
                audio = torch.frombuffer(bytearray(pcm), dtype=torch.int16).float() / 32768.0
                if sample_rate != 16000:
                    # Silero expects 16k; coarse resample by stride for endpointing only.
                    step = max(1, sample_rate // 16000)
                    audio = audio[::step]

                # Process audio in 512-sample frames as Silero expects.
                # The model maintains LSTM state across frames for context.
                frame_size = _SILERO_FRAME_SIZE
                total_frames = 0
                speech_frames = 0
                max_prob = 0.0
                for i in range(0, len(audio) - frame_size + 1, frame_size):
                    frame = audio[i:i + frame_size]
                    prob = float(self.model(frame, 16000).item())
                    max_prob = max(max_prob, prob)
                    total_frames += 1
                    if prob >= self.threshold:
                        speech_frames += 1
                        self._speech_frame_count += 1
                        self._silence_frame_count = 0
                    else:
                        self._silence_frame_count += 1
                        self._speech_frame_count = 0

                # Debounced state: require consecutive frames to flip state.
                if self._speech_frame_count >= _SPEECH_FRAMES_MIN:
                    self._current_is_speech = True
                elif self._silence_frame_count >= _SILENCE_FRAMES_MIN:
                    self._current_is_speech = False

                # If we didn't have enough frames to fill a single Silero frame,
                # fall back to per-chunk probability on whatever we have.
                if total_frames == 0 and len(audio) > 0:
                    # Pad to 512 samples with zeros if we have a short chunk.
                    padded = torch.zeros(_SILERO_FRAME_SIZE)
                    padded[:len(audio)] = audio[:_SILERO_FRAME_SIZE]
                    prob = float(self.model(padded, 16000).item())
                    max_prob = prob
                    if prob >= self.threshold:
                        self._speech_frame_count += 1
                        self._silence_frame_count = 0
                        if self._speech_frame_count >= _SPEECH_FRAMES_MIN:
                            self._current_is_speech = True
                    else:
                        self._silence_frame_count += 1
                        self._speech_frame_count = 0
                        if self._silence_frame_count >= _SILENCE_FRAMES_MIN:
                            self._current_is_speech = False

                is_speech = self._current_is_speech
                return {
                    "isSpeech": is_speech,
                    "confidence": max_prob,
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
