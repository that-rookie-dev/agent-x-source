from __future__ import annotations

import base64
from unittest.mock import MagicMock

import numpy as np

from agentx_voice.stt_faster_whisper import FasterWhisperStt, _MIN_PARTIAL_BYTES


def _pcm(seconds: float, sample_rate: int = 16_000) -> bytes:
    count = int(sample_rate * seconds)
    return (np.zeros(count, dtype=np.int16)).tobytes()


def test_preview_transcribe_does_not_mutate_stream_buffer(tmp_path, monkeypatch) -> None:
    stt = FasterWhisperStt(str(tmp_path))
    pcm = _pcm(0.5)
    pcm_b64 = base64.b64encode(pcm).decode("ascii")

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MagicMock(language="en"))
    monkeypatch.setattr(stt, "_load", lambda *_args, **_kwargs: mock_model)

    response = stt.stream_transcribe(
        {"pcmBase64": pcm_b64, "sampleRate": 16_000, "preview": True},
    )

    assert response["partial"] == ""
    assert len(stt._stream_buffer) == 0


def test_preview_does_not_feed_overlapping_windows_into_vad(tmp_path, monkeypatch) -> None:
    """Regression: preview used to re-run Silero on a trailing 5s window every tick,
    which kept isSpeech stuck true after the user stopped talking."""
    stt = FasterWhisperStt(str(tmp_path))
    pcm = _pcm(0.5)
    pcm_b64 = base64.b64encode(pcm).decode("ascii")

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MagicMock(language="en"))
    monkeypatch.setattr(stt, "_load", lambda *_args, **_kwargs: mock_model)

    vad = MagicMock()
    vad.detect.return_value = {"isSpeech": True, "speechEndMs": None}

    response = stt.stream_transcribe(
        {"pcmBase64": pcm_b64, "sampleRate": 16_000, "preview": True},
        vad=vad,
    )

    assert vad.detect.call_count == 0
    assert response.get("isSpeech") is None
    assert response.get("speechEnd") is False


def test_finalize_resets_stream_buffer(tmp_path, monkeypatch) -> None:
    stt = FasterWhisperStt(str(tmp_path))
    pcm = _pcm(0.5)
    pcm_b64 = base64.b64encode(pcm).decode("ascii")

    segment = MagicMock()
    segment.text = "hello world"
    segment.start = 0.0
    segment.end = 0.4
    segment.avg_logprob = -0.1

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([segment], MagicMock(language="en"))
    monkeypatch.setattr(stt, "_load", lambda *_args, **_kwargs: mock_model)

    stt.stream_transcribe({"pcmBase64": pcm_b64, "sampleRate": 16_000})
    assert len(stt._stream_buffer) > 0

    response = stt.stream_transcribe({"finalize": True, "sampleRate": 16_000})
    assert response["text"] == "hello world"
    assert len(stt._stream_buffer) == 0


def test_partial_decode_is_throttled_by_growth(tmp_path, monkeypatch) -> None:
    stt = FasterWhisperStt(str(tmp_path))

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MagicMock(language="en"))
    monkeypatch.setattr(stt, "_load", lambda *_args, **_kwargs: mock_model)

    first = _pcm(0.35)
    second = _pcm(0.1)

    stt.stream_transcribe(
        {"pcmBase64": base64.b64encode(first).decode("ascii"), "sampleRate": 16_000},
    )
    calls_after_first = mock_model.transcribe.call_count

    stt.stream_transcribe(
        {"pcmBase64": base64.b64encode(second).decode("ascii"), "sampleRate": 16_000},
    )
    calls_after_second = mock_model.transcribe.call_count

    assert calls_after_first == 1
    assert calls_after_second == 1


def test_transcribe_pcm_uses_numpy_path(tmp_path, monkeypatch) -> None:
    stt = FasterWhisperStt(str(tmp_path))
    pcm = _pcm(0.4)
    pcm_b64 = base64.b64encode(pcm).decode("ascii")

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MagicMock(language="en"))
    monkeypatch.setattr(stt, "_load", lambda *_args, **_kwargs: mock_model)

    stt.transcribe_pcm({"pcmBase64": pcm_b64, "sampleRate": 16_000})

    assert mock_model.transcribe.call_count == 1
    audio_arg = mock_model.transcribe.call_args.args[0]
    assert isinstance(audio_arg, np.ndarray)
    assert audio_arg.dtype == np.float32
    assert len(audio_arg) >= _MIN_PARTIAL_BYTES // 2
