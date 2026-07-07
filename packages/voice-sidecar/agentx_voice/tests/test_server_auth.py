from __future__ import annotations

import json
import threading
from http.client import HTTPConnection
from typing import Any
from unittest.mock import MagicMock

from agentx_voice.protocol import SidecarConfig
from agentx_voice.server import VoiceSidecarServer


def _request(
    port: int,
    method: str,
    path: str,
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    payload = json.dumps(body or {}).encode("utf-8")
    conn.request(method, path, body=payload, headers=headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()
    return response.status, json.loads(raw) if raw else {}


def test_health_requires_auth_token(tmp_path) -> None:
    config = SidecarConfig(
        host="127.0.0.1",
        port=0,
        auth_token="secret-token",
        data_dir=str(tmp_path),
    )
    server = VoiceSidecarServer(config)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        status, _ = _request(actual_port, "GET", "/health", token=None)
        assert status == 401

        status, payload = _request(actual_port, "GET", "/health", token="secret-token")
        assert status == 200
        assert payload["ok"] is True
        assert payload["models"]["sttLoaded"] is False
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_stt_stream_endpoint_uses_runtime(tmp_path, monkeypatch) -> None:
    config = SidecarConfig(
        host="127.0.0.1",
        port=0,
        auth_token="secret-token",
        data_dir=str(tmp_path),
    )
    server = VoiceSidecarServer(config)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    mock_stream = MagicMock(return_value={"partial": "hello", "text": None})
    monkeypatch.setattr(server.runtime.stt, "stream_transcribe", mock_stream)

    try:
        status, payload = _request(
            actual_port,
            "POST",
            "/stt/stream",
            token="secret-token",
            body={"pcmBase64": "AA==", "sampleRate": 16_000},
        )
        assert status == 200
        assert payload["partial"] == "hello"
        mock_stream.assert_called_once()
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_warm_unloads_inactive_tts_engine(tmp_path, monkeypatch) -> None:
    config = SidecarConfig(
        host="127.0.0.1",
        port=0,
        auth_token="secret-token",
        data_dir=str(tmp_path),
    )
    server = VoiceSidecarServer(config)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    unload_kokoro = MagicMock()
    unload_style = MagicMock()
    warm_stt = MagicMock()
    warm_kokoro = MagicMock()
    warm_style = MagicMock()
    warm_vad = MagicMock()

    monkeypatch.setattr(server.runtime.stt, "warm", warm_stt)
    monkeypatch.setattr(server.runtime.kokoro, "warm", warm_kokoro)
    monkeypatch.setattr(server.runtime.kokoro, "unload", unload_kokoro)
    monkeypatch.setattr(server.runtime.styletts2, "warm", warm_style)
    monkeypatch.setattr(server.runtime.styletts2, "unload", unload_style)
    monkeypatch.setattr(server.runtime.vad, "warm", warm_vad)

    try:
        status, payload = _request(
            actual_port,
            "POST",
            "/warm",
            token="secret-token",
            body={"ttsEngine": "styletts2"},
        )
        assert status == 200
        assert payload["models"]["ttsEngine"] == "styletts2"
        unload_kokoro.assert_called_once()
        warm_style.assert_called_once()
        unload_style.assert_not_called()

        status, payload = _request(
            actual_port,
            "POST",
            "/warm",
            token="secret-token",
            body={"ttsEngine": "kokoro"},
        )
        assert status == 200
        assert payload["models"]["ttsEngine"] == "kokoro"
        unload_style.assert_called_once()
        warm_kokoro.assert_called_once()
    finally:
        server.shutdown()
        thread.join(timeout=2)
