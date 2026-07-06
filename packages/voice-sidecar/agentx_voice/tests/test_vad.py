from __future__ import annotations

import array

from agentx_voice.vad_silero import SileroVad


def _pcm_from_samples(samples: list[int]) -> bytes:
    buf = array.array("h", samples)
    return buf.tobytes()


def test_vad_energy_fallback_detects_silence() -> None:
    vad = SileroVad()
    pcm = _pcm_from_samples([0] * 320)
    result = vad.detect({"pcm": pcm, "sampleRate": 16_000})
    assert result["isSpeech"] is False
    assert result["confidence"] == 0.0


def test_vad_energy_fallback_detects_speech() -> None:
    vad = SileroVad()
    pcm = _pcm_from_samples([20_000] * 320)
    result = vad.detect({"pcm": pcm, "sampleRate": 16_000})
    assert result["isSpeech"] is True
    assert result["confidence"] > 0.0


def test_vad_requires_pcm_bytes() -> None:
    vad = SileroVad()
    try:
        vad.detect({"pcm": "not-bytes", "sampleRate": 16_000})
    except ValueError as error:
        assert "pcm bytes are required" in str(error)
    else:
        raise AssertionError("Expected ValueError for invalid pcm input")
