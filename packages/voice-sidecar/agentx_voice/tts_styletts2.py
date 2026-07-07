from __future__ import annotations

import base64
import re
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_TORCH_LOAD_PATCHED = False


def _patch_torch_load_for_legacy_checkpoints() -> None:
    """StyleTTS 2 checkpoints require full pickle load; PyTorch 2.6+ defaults to weights_only=True."""
    global _TORCH_LOAD_PATCHED
    if _TORCH_LOAD_PATCHED:
        return

    import torch

    original_load = torch.load

    def patched_load(*args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault("weights_only", False)
        return original_load(*args, **kwargs)

    torch.load = patched_load  # type: ignore[method-assign]
    _TORCH_LOAD_PATCHED = True


def _resolve_styletts2_paths(model_dir: Path) -> tuple[Path, Path]:
    config_candidates = sorted(model_dir.rglob("config.yml"))
    if not config_candidates:
        raise FileNotFoundError(f"StyleTTS 2 config.yml not found under {model_dir}")

    config_path = config_candidates[0]
    checkpoint_candidates = sorted(model_dir.rglob("epochs_2nd*.pth"))
    if not checkpoint_candidates:
        checkpoint_candidates = sorted(model_dir.rglob("*.pth"))
    if not checkpoint_candidates:
        raise FileNotFoundError(f"StyleTTS 2 checkpoint (.pth) not found under {model_dir}")

    return checkpoint_candidates[-1], config_path


class StyleTts2:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.model = None

    def warm(self, request: dict[str, Any]) -> None:
        self._load()

    def unload(self) -> None:
        self.model = None

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        output_path = request.get("outputPath")
        if not isinstance(output_path, str) or not output_path:
            tmp_dir = self.data_dir / "tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(tmp_dir / f"styletts2-{int(time.time() * 1000)}.wav")

        style = request.get("style") if isinstance(request.get("style"), dict) else {}
        expressiveness = float(style.get("expressiveness", 1.0)) if isinstance(style, dict) else 1.0
        started = time.perf_counter()
        model = self._load()

        kwargs: dict[str, Any] = {
            "output_wav_file": output_path,
            "output_sample_rate": 24_000,
            "embedding_scale": expressiveness,
        }
        target_voice_path = self._resolve_target_voice(request.get("voiceId"))
        if target_voice_path:
            kwargs["target_voice_path"] = str(target_voice_path)

        audio = model.inference(text, **kwargs)
        if audio is not None and not Path(output_path).exists():
            try:
                import soundfile as sf
            except ImportError as exc:
                raise RuntimeError("soundfile is required to write StyleTTS 2 audio.") from exc
            sf.write(output_path, audio, 24_000)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "audioPath": output_path,
            "sampleRate": 24_000,
            "timings": {"synthesizeMs": elapsed_ms},
        }

    def synthesize_stream(self, request: dict[str, Any], cancel_check: Callable[[], bool] | None = None) -> Iterator[dict[str, Any]]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        style = request.get("style") if isinstance(request.get("style"), dict) else {}
        expressiveness = float(style.get("expressiveness", 1.0)) if isinstance(style, dict) else 1.0
        model = self._load()
        sample_rate = 24_000
        target_voice_path = self._resolve_target_voice(request.get("voiceId"))

        try:
            import numpy as np
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError("numpy and soundfile are required for StyleTTS 2 synthesis.") from exc

        tmp_dir = self.data_dir / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        for index, sentence in enumerate(_split_sentences(text)):
            if cancel_check and cancel_check():
                break
            output_path = tmp_dir / f"styletts2-stream-{int(time.time() * 1000)}-{index}.wav"
            kwargs: dict[str, Any] = {
                "output_wav_file": str(output_path),
                "output_sample_rate": sample_rate,
                "embedding_scale": expressiveness,
            }
            if target_voice_path:
                kwargs["target_voice_path"] = str(target_voice_path)

            audio = model.inference(sentence, **kwargs)
            if audio is not None and not output_path.exists():
                sf.write(output_path, audio, sample_rate)

            if not output_path.exists():
                continue

            wav_audio, wav_rate = sf.read(str(output_path), dtype="float32")
            if wav_rate != sample_rate:
                continue
            pcm = _float_audio_to_pcm16(np.asarray(wav_audio))
            yield {
                "pcmBase64": base64.b64encode(pcm).decode("ascii"),
                "sampleRate": sample_rate,
            }
            output_path.unlink(missing_ok=True)

    def _load(self):
        if self.model is not None:
            return self.model

        model_path = self.data_dir / "models" / "tts" / "styletts2" / "styletts2"
        if not model_path.exists():
            raise FileNotFoundError("StyleTTS 2 model is not installed")

        _patch_torch_load_for_legacy_checkpoints()

        try:
            from styletts2 import tts
        except ImportError as exc:
            raise RuntimeError("styletts2 is not installed. Install sidecar dependencies first.") from exc

        checkpoint_path, config_path = _resolve_styletts2_paths(model_path)
        self.model = tts.StyleTTS2(
            model_checkpoint_path=str(checkpoint_path),
            config_path=str(config_path),
        )
        return self.model

    def _resolve_target_voice(self, voice_id: Any) -> Path | None:
        if not isinstance(voice_id, str) or voice_id in ("", "styletts2-default"):
            return None

        candidate = self.data_dir / "models" / "tts" / "styletts2" / "voices" / voice_id
        if candidate.exists():
            return candidate
        return None


def _split_sentences(text: str) -> list[str]:
    parts = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    return parts or [text]


def _float_audio_to_pcm16(audio: Any) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    return pcm16.tobytes()
