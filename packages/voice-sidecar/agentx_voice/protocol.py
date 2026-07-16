from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

TtsEngine = Literal["kokoro"]


@dataclass(frozen=True)
class SidecarConfig:
    host: str
    port: int
    auth_token: str
    data_dir: str


def health_payload(state: str = "ready", **extra: Any) -> dict[str, Any]:
    return {
        "ok": state == "ready",
        "state": state,
        **extra,
    }
