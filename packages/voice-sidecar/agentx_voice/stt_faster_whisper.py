from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any

import numpy as np

# Minimum buffered audio before attempting a live partial decode (~200ms @ 16kHz mono s16).
_MIN_PARTIAL_BYTES = int(16_000 * 0.2) * 2
# Only re-run partial decode when the stream buffer grew by ~200ms since last pass.
_MIN_PARTIAL_GROWTH_BYTES = int(16_000 * 0.2) * 2
# Preview requests decode only the trailing window for lower latency captions.
_PREVIEW_TAIL_SECONDS = 3.0


class FasterWhisperStt:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.model = None
        self.loaded_model_id: str | None = None
        self.loaded_device: str | None = None
        self.loaded_compute_type: str | None = None
        self._stream_buffer = bytearray()
        self._stream_sample_rate = 16_000
        self._max_buffer_seconds = 30
        self._last_partial_decode_bytes = 0
        self._last_partial_decode_at = 0.0

    def warm(self, request: dict[str, Any]) -> None:
        model_id = str(request.get("sttModelId") or request.get("modelId") or "faster-distil-whisper-small.en")
        device = str(request.get("sttDevice") or request.get("device") or "auto")
        compute_type = str(request.get("sttComputeType") or request.get("computeType") or "int8")
        self._load(model_id, device, compute_type)

    def transcribe(self, request: dict[str, Any]) -> dict[str, Any]:
        audio_path = request.get("audioPath")
        if not isinstance(audio_path, str) or not audio_path:
            raise ValueError("audioPath is required")

        model_id = str(request.get("modelId") or request.get("sttModelId") or "faster-distil-whisper-small.en")
        device = str(request.get("device") or request.get("sttDevice") or "auto")
        compute_type = str(request.get("computeType") or request.get("sttComputeType") or "int8")
        model = self._load(model_id, device, compute_type)

        segments_iter, info = model.transcribe(
            audio_path,
            language=request.get("language"),
            beam_size=1,
            vad_filter=True,
            word_timestamps=True,
        )
        return self._segments_to_response(segments_iter, info)

    def transcribe_pcm(self, request: dict[str, Any]) -> dict[str, Any]:
        pcm = self._decode_pcm_request(request)
        sample_rate = int(request.get("sampleRate", 16_000))
        return self._transcribe_pcm_bytes(
            pcm,
            sample_rate,
            request,
            partial=False,
            vad_filter=True,
            word_timestamps=True,
        )

    def stream_transcribe(self, request: dict[str, Any], vad: Any | None = None) -> dict[str, Any]:
        if request.get("reset"):
            self._reset_stream_state()

        sample_rate = int(request.get("sampleRate", self._stream_sample_rate or 16_000))
        self._stream_sample_rate = sample_rate
        pcm_b64 = request.get("pcmBase64") or request.get("pcm")
        finalize = bool(request.get("finalize") or request.get("final"))
        preview = bool(request.get("preview"))

        vad_result: dict[str, Any] | None = None
        if isinstance(pcm_b64, str) and pcm_b64:
            pcm = base64.b64decode(pcm_b64)
            if vad is not None and pcm and not preview:
                vad_result = vad.detect({"pcm": pcm, "sampleRate": sample_rate})
            if preview:
                return self._preview_transcribe(pcm, sample_rate, request, vad_result)
            self._append_stream_pcm(pcm)

        speech_end = bool(vad_result and vad_result.get("speechEndMs") is not None and not vad_result.get("isSpeech"))

        response: dict[str, Any] = {
            "partial": None,
            "text": None,
            "isSpeech": bool(vad_result.get("isSpeech")) if vad_result else None,
            "speechEnd": speech_end,
            "vad": vad_result,
        }

        buffer_len = len(self._stream_buffer)
        if buffer_len < _MIN_PARTIAL_BYTES and not finalize and not speech_end:
            return response

        if finalize or speech_end:
            result = self._transcribe_stream_buffer(
                request,
                partial=False,
                vad_filter=True,
                word_timestamps=True,
            )
            response["text"] = result.get("text", "")
            response["segments"] = result.get("segments")
            response["language"] = result.get("language")
            response["confidence"] = result.get("confidence")
            self._reset_stream_state()
            return response

        if not self._should_decode_partial(buffer_len):
            return response

        result = self._transcribe_stream_buffer(
            request,
            partial=True,
            vad_filter=False,
            word_timestamps=False,
        )
        response["partial"] = result.get("text", "")
        self._last_partial_decode_bytes = buffer_len
        self._last_partial_decode_at = time.monotonic()
        return response

    def _preview_transcribe(
        self,
        pcm: bytes,
        sample_rate: int,
        request: dict[str, Any],
        vad_result: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if len(pcm) < _MIN_PARTIAL_BYTES:
            return {
                "partial": None,
                "text": None,
                "isSpeech": bool(vad_result.get("isSpeech")) if vad_result else None,
                "speechEnd": False,
                "vad": vad_result,
            }

        preview_pcm = self._tail_pcm(pcm, sample_rate, _PREVIEW_TAIL_SECONDS)
        result = self._transcribe_pcm_bytes(
            preview_pcm,
            sample_rate,
            request,
            partial=True,
            vad_filter=False,
            word_timestamps=False,
        )
        return {
            "partial": result.get("text", ""),
            "text": None,
            "isSpeech": bool(vad_result.get("isSpeech")) if vad_result else None,
            "speechEnd": False,
            "vad": vad_result,
        }

    def _should_decode_partial(self, buffer_len: int) -> bool:
        if buffer_len < _MIN_PARTIAL_BYTES:
            return False
        if self._last_partial_decode_bytes == 0:
            return True
        if buffer_len - self._last_partial_decode_bytes >= _MIN_PARTIAL_GROWTH_BYTES:
            return True
        return (time.monotonic() - self._last_partial_decode_at) >= 0.5

    def _transcribe_stream_buffer(
        self,
        request: dict[str, Any],
        *,
        partial: bool,
        vad_filter: bool,
        word_timestamps: bool,
    ) -> dict[str, Any]:
        return self._transcribe_pcm_bytes(
            bytes(self._stream_buffer),
            self._stream_sample_rate,
            request,
            partial=partial,
            vad_filter=vad_filter,
            word_timestamps=word_timestamps,
        )

    def _transcribe_pcm_bytes(
        self,
        pcm: bytes,
        sample_rate: int,
        request: dict[str, Any],
        *,
        partial: bool,
        vad_filter: bool,
        word_timestamps: bool,
    ) -> dict[str, Any]:
        if not pcm:
            return {"text": "", "segments": [], "language": None, "confidence": None}

        model_id = str(request.get("modelId") or request.get("sttModelId") or "faster-distil-whisper-small.en")
        device = str(request.get("device") or request.get("sttDevice") or "auto")
        compute_type = str(request.get("computeType") or request.get("sttComputeType") or "int8")
        model = self._load(model_id, device, compute_type)
        audio = self._pcm_to_float32(pcm)

        segments_iter, info = model.transcribe(
            audio,
            language=request.get("language"),
            beam_size=1,
            vad_filter=vad_filter,
            word_timestamps=word_timestamps,
            condition_on_previous_text=not partial,
        )
        return self._segments_to_response(segments_iter, info)

    def _append_stream_pcm(self, pcm: bytes) -> None:
        self._stream_buffer.extend(pcm)
        max_bytes = self._stream_sample_rate * 2 * self._max_buffer_seconds
        if len(self._stream_buffer) > max_bytes:
            self._stream_buffer = self._stream_buffer[-max_bytes:]
            self._last_partial_decode_bytes = min(self._last_partial_decode_bytes, len(self._stream_buffer))

    def _reset_stream_state(self) -> None:
        self._stream_buffer.clear()
        self._last_partial_decode_bytes = 0
        self._last_partial_decode_at = 0.0

    def _decode_pcm_request(self, request: dict[str, Any]) -> bytes:
        pcm_b64 = request.get("pcmBase64") or request.get("pcm")
        if not isinstance(pcm_b64, str) or not pcm_b64:
            raise ValueError("pcmBase64 is required")
        pcm = base64.b64decode(pcm_b64)
        if not pcm:
            raise ValueError("pcmBase64 decoded to empty audio")
        return pcm

    @staticmethod
    def _pcm_to_float32(pcm: bytes) -> np.ndarray:
        samples = np.frombuffer(pcm, dtype=np.int16)
        if samples.size == 0:
            return np.zeros(0, dtype=np.float32)
        return (samples.astype(np.float32)) / 32768.0

    @staticmethod
    def _tail_pcm(pcm: bytes, sample_rate: int, max_seconds: float) -> bytes:
        max_bytes = int(sample_rate * 2 * max_seconds)
        if len(pcm) <= max_bytes:
            return pcm
        return pcm[-max_bytes:]

    def _segments_to_response(self, segments_iter: Any, info: Any) -> dict[str, Any]:
        segments = []
        texts = []
        confidences = []
        for segment in segments_iter:
            text = segment.text.strip()
            if text:
                texts.append(text)
            avg_logprob = getattr(segment, "avg_logprob", None)
            if isinstance(avg_logprob, (int, float)):
                confidences.append(max(0.0, min(1.0, 1.0 + float(avg_logprob))))
            segments.append({
                "text": text,
                "startMs": int(float(segment.start) * 1000),
                "endMs": int(float(segment.end) * 1000),
            })

        return {
            "text": " ".join(texts).strip(),
            "language": getattr(info, "language", None),
            "confidence": sum(confidences) / len(confidences) if confidences else None,
            "segments": segments,
        }

    def _load(self, model_id: str, device: str, compute_type: str):
        if (
            self.model is not None
            and self.loaded_model_id == model_id
            and self.loaded_device == device
            and self.loaded_compute_type == compute_type
        ):
            return self.model

        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper is not installed. Install sidecar dependencies first.") from exc

        model_path = self.data_dir / "models" / "stt" / model_id
        if not model_path.exists():
            raise FileNotFoundError(f"faster-whisper model is not installed: {model_id}")

        resolved_device = "cpu" if device == "auto" else device
        self.model = WhisperModel(str(model_path), device=resolved_device, compute_type=compute_type)
        self.loaded_model_id = model_id
        self.loaded_device = device
        self.loaded_compute_type = compute_type
        return self.model
