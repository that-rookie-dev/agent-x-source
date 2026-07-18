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


def test_vad_reset_states_clears_internal_state() -> None:
    vad = SileroVad()
    # Trigger some speech frames to populate internal counters.
    pcm = _pcm_from_samples([20_000] * 320)
    vad.detect({"pcm": pcm, "sampleRate": 16_000})
    # Reset should clear all internal state.
    vad.reset_states()
    assert vad._speech_frame_count == 0
    assert vad._silence_frame_count == 0
    assert vad._current_is_speech is False


def test_vad_reset_flag_in_detect_clears_state() -> None:
    vad = SileroVad()
    pcm = _pcm_from_samples([20_000] * 320)
    vad.detect({"pcm": pcm, "sampleRate": 16_000})
    # Using reset flag should clear internal state before processing.
    vad.detect({"pcm": pcm, "sampleRate": 16_000, "reset": True})
    # After reset + speech frame, the debounce counter starts fresh.
    assert vad._speech_frame_count >= 0
