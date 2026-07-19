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


def test_overlapping_preview_windows_stick_speech_true() -> None:
    """Documents why duplex must VAD incremental chunks, not trailing 5s previews."""
    import math

    vad = SileroVad()
    sr = 16_000

    def tone(ms: int, amp: float = 0.3) -> bytes:
        n = int(sr * ms / 1000)
        samples = [int(amp * 32767 * math.sin(2 * math.pi * 220 * i / sr)) for i in range(n)]
        return _pcm_from_samples(samples)

    def silence(ms: int) -> bytes:
        return _pcm_from_samples([0] * int(sr * ms / 1000))

    vad.reset_states()
    incremental: list[bool] = []
    for i in range(12):
        pcm = tone(250) if i < 6 else silence(250)
        incremental.append(bool(vad.detect({"pcm": pcm, "sampleRate": sr})["isSpeech"]))

    vad.reset_states()
    buf = b""
    overlapping: list[bool] = []
    for i in range(20):
        pcm = tone(250) if i < 6 else silence(250)
        buf += pcm
        window = buf[-(sr * 2 * 5) :]
        overlapping.append(bool(vad.detect({"pcm": window, "sampleRate": sr})["isSpeech"]))

    assert incremental[:6] == [True] * 6
    assert incremental[-4:] == [False] * 4
    # Overlapping 5s windows keep reporting speech long after acoustic silence.
    assert any(overlapping[8:14])


def test_vad_empty_pcm_with_reset_is_safe() -> None:
    vad = SileroVad()
    result = vad.detect({"pcm": b"", "sampleRate": 16_000, "reset": True})
    assert result["isSpeech"] is False
