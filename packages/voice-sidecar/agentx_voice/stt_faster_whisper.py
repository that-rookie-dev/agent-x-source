from __future__ import annotations

import base64
import time
import wave
from pathlib import Path
from typing import Any


class FasterWhisperStt:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.model = None
        self.loaded_model_id: str | None = None
        self.loaded_device: str | None = None
        self.loaded_compute_type: str | None = None
        self._stream_buffer = bytearray()
        self._stream_sample_rate = 16_000

    def warm(self, request: dict[str, Any]) -> None:
        model_id = str(request.get("sttModelId") or request.get("modelId") or "faster-whisper-base.en")
        device = str(request.get("sttDevice") or request.get("device") or "auto")
        compute_type = str(request.get("sttComputeType") or request.get("computeType") or "int8")
        self._load(model_id, device, compute_type)

    def transcribe(self, request: dict[str, Any]) -> dict[str, Any]:
        audio_path = request.get("audioPath")
        if not isinstance(audio_path, str) or not audio_path:
            raise ValueError("audioPath is required")

        model_id = str(request.get("modelId") or request.get("sttModelId") or "faster-whisper-base.en")
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
        pcm_b64 = request.get("pcmBase64") or request.get("pcm")
        if not isinstance(pcm_b64, str) or not pcm_b64:
            raise ValueError("pcmBase64 is required")

        sample_rate = int(request.get("sampleRate", 16_000))
        pcm = base64.b64decode(pcm_b64)
        if not pcm:
            raise ValueError("pcmBase64 decoded to empty audio")

        tmp_dir = self.data_dir / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        wav_path = tmp_dir / f"pcm-{int(time.time() * 1000)}.wav"
        try:
            _write_pcm_as_wav(pcm, wav_path, sample_rate)
            transcribe_request = {**request, "audioPath": str(wav_path)}
            transcribe_request.pop("pcmBase64", None)
            transcribe_request.pop("pcm", None)
            return self.transcribe(transcribe_request)
        finally:
            wav_path.unlink(missing_ok=True)

    def stream_transcribe(self, request: dict[str, Any], vad: Any | None = None) -> dict[str, Any]:
        if request.get("reset"):
            self._stream_buffer.clear()

        pcm_b64 = request.get("pcmBase64") or request.get("pcm")
        sample_rate = int(request.get("sampleRate", self._stream_sample_rate or 16_000))
        self._stream_sample_rate = sample_rate

        vad_result: dict[str, Any] | None = None
        if isinstance(pcm_b64, str) and pcm_b64:
            pcm = base64.b64decode(pcm_b64)
            self._stream_buffer.extend(pcm)
            if vad is not None:
                vad_result = vad.detect({"pcm": pcm, "sampleRate": sample_rate})

        finalize = bool(request.get("finalize") or request.get("final"))
        speech_end = bool(vad_result and vad_result.get("speechEndMs") is not None and not vad_result.get("isSpeech"))
        min_bytes = int(sample_rate * 0.3) * 2

        response: dict[str, Any] = {
            "partial": None,
            "text": None,
            "isSpeech": bool(vad_result.get("isSpeech")) if vad_result else None,
            "speechEnd": speech_end,
            "vad": vad_result,
        }

        if len(self._stream_buffer) < min_bytes and not finalize and not speech_end:
            return response

        wav_path = self._buffer_to_temp_wav()
        try:
            if finalize or speech_end:
                result = self.transcribe({**request, "audioPath": str(wav_path)})
                response["text"] = result.get("text", "")
                response["segments"] = result.get("segments")
                response["language"] = result.get("language")
                response["confidence"] = result.get("confidence")
                self._stream_buffer.clear()
            else:
                result = self._transcribe_partial({**request, "audioPath": str(wav_path)})
                response["partial"] = result.get("text", "")
        finally:
            wav_path.unlink(missing_ok=True)

        return response

    def _transcribe_partial(self, request: dict[str, Any]) -> dict[str, Any]:
        audio_path = request.get("audioPath")
        if not isinstance(audio_path, str) or not audio_path:
            raise ValueError("audioPath is required")

        model_id = str(request.get("modelId") or request.get("sttModelId") or "faster-whisper-base.en")
        device = str(request.get("device") or request.get("sttDevice") or "auto")
        compute_type = str(request.get("computeType") or request.get("sttComputeType") or "int8")
        model = self._load(model_id, device, compute_type)

        segments_iter, info = model.transcribe(
            audio_path,
            language=request.get("language"),
            beam_size=1,
            vad_filter=False,
            word_timestamps=False,
        )
        return self._segments_to_response(segments_iter, info)

    def _buffer_to_temp_wav(self) -> Path:
        tmp_dir = self.data_dir / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        wav_path = tmp_dir / f"stream-{int(time.time() * 1000)}.wav"
        _write_pcm_as_wav(bytes(self._stream_buffer), wav_path, self._stream_sample_rate)
        return wav_path

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


def _write_pcm_as_wav(pcm: bytes, wav_path: Path, sample_rate: int) -> None:
    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
