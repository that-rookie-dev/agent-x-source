from __future__ import annotations

import agentx_voice.tts_styletts2 as tts_mod
from agentx_voice.tts_styletts2 import _patch_torch_load_for_legacy_checkpoints


def test_torch_load_patch_defaults_weights_only_false(monkeypatch) -> None:
    tts_mod._TORCH_LOAD_PATCHED = False
    captured: dict[str, object] = {}

    def fake_original(*args, **kwargs):
        captured.update(kwargs)
        return {"net": {}}

    import torch

    monkeypatch.setattr(torch, "load", fake_original)
    _patch_torch_load_for_legacy_checkpoints()
    torch.load("x.pth", map_location="cpu")
    assert captured.get("weights_only") is False
