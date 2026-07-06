from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def manifest_path() -> Path:
    env_path = os.environ.get("AGENTX_VOICE_MANIFEST_PATH")
    if env_path and Path(env_path).exists():
        return Path(env_path)
    bundled = [
        Path(__file__).resolve().parent.parent / "voice-models.manifest.json",
    ]
    for candidate in bundled:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("voice-models.manifest.json not found")


def load_manifest() -> dict[str, Any]:
    with manifest_path().open("r", encoding="utf-8") as handle:
        return json.load(handle)


def get_asset_spec(asset_id: str) -> dict[str, Any]:
    manifest = load_manifest()
    for asset in manifest.get("assets", []):
        if asset.get("id") == asset_id:
            return asset
    raise KeyError(f"Unknown voice asset in manifest: {asset_id}")


def bundled_asset_dir(asset_id: str) -> Path | None:
    bundle_root = os.environ.get("AGENTX_VOICE_BUNDLE_DIR")
    if not bundle_root:
        return None
    candidate = Path(bundle_root) / asset_id
    return candidate if candidate.exists() else None
