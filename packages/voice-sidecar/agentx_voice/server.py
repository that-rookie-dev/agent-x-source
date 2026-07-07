from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import deque
from typing import Any, Literal
from agentx_voice import __version__
from agentx_voice.protocol import SidecarConfig, health_payload
from agentx_voice.stt_faster_whisper import FasterWhisperStt
from agentx_voice.tts_kokoro import KokoroTts
from agentx_voice.tts_styletts2 import StyleTts2
from agentx_voice.vad_silero import SileroVad

TtsEngine = Literal["kokoro", "styletts2"]


class VoiceRuntime:
    def __init__(self, config: SidecarConfig) -> None:
        self.config = config
        self.stt = FasterWhisperStt(config.data_dir)
        self.kokoro = KokoroTts(config.data_dir)
        self.styletts2 = StyleTts2(config.data_dir)
        self.vad = SileroVad(config.data_dir)
        self.active_tts_engine: TtsEngine = "kokoro"
        self.cancelled_request_ids: deque[str] = deque(maxlen=500)

    def cancel(self, request: dict[str, Any]) -> dict[str, Any]:
        request_id = request.get("requestId")
        if request_id:
            self.cancelled_request_ids.add(str(request_id))
        return {"ok": True}

    def is_cancelled(self, request_id: str | None) -> bool:
        if not request_id:
            return False
        return str(request_id) in self.cancelled_request_ids

    def health(self) -> dict[str, Any]:
        tts_loaded = (
            self.kokoro.pipeline is not None
            if self.active_tts_engine == "kokoro"
            else self.styletts2.model is not None
        )
        return health_payload(
            "ready",
            version=__version__,
            models={
                "sttLoaded": self.stt.model is not None,
                "ttsEngine": self.active_tts_engine,
                "ttsLoaded": tts_loaded,
                "vadLoaded": self.vad.model is not None,
            },
        )

    def warm(self, request: dict[str, Any]) -> dict[str, Any]:
        self.stt.warm(request)
        engine = request.get("ttsEngine")
        if engine == "styletts2":
            self.active_tts_engine = "styletts2"
            self.kokoro.unload()
            self.styletts2.warm(request)
        else:
            self.active_tts_engine = "kokoro"
            self.styletts2.unload()
            self.kokoro.warm(request)
        self.vad.warm(request)
        return self.health()


class VoiceRequestHandler(BaseHTTPRequestHandler):
    server_version = "AgentXVoiceSidecar/0.1"

    @property
    def runtime(self) -> VoiceRuntime:
        return self.server.runtime  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        print(format % args, flush=True)

    def do_GET(self) -> None:
        if not self._authorized():
            self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return

        if self.path == "/health":
            self._send_json(self.runtime.health())
            return

        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self._authorized():
            self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return

        try:
            request = self._read_json()
            response = self._handle_post(request)
            self._send_json(response)
        except NotImplementedError as error:
            self._send_json({"error": str(error), "code": "not_implemented"}, HTTPStatus.NOT_IMPLEMENTED)
        except ValueError as error:
            self._send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:
            self._send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _handle_post(self, request: dict[str, Any]) -> dict[str, Any]:
        if self.path == "/warm":
            return self.runtime.warm(request)
        if self.path == "/stt/transcribe":
            if request.get("pcmBase64") or request.get("pcm"):
                return self.runtime.stt.transcribe_pcm(request)
            return self.runtime.stt.transcribe(request)
        if self.path == "/stt/stream":
            return self.runtime.stt.stream_transcribe(request, vad=self.runtime.vad)
        if self.path == "/tts/synthesize":
            engine = request.get("engine")
            if engine == "styletts2":
                return self.runtime.styletts2.synthesize(request)
            if engine == "kokoro":
                return self.runtime.kokoro.synthesize(request)
            raise ValueError("Unsupported TTS engine")
        if self.path == "/tts/stream":
            engine = request.get("engine")
            cancel_check = lambda: self.runtime.is_cancelled(str(request.get("requestId") or ""))
            if engine == "styletts2":
                chunks = list(self.runtime.styletts2.synthesize_stream(request, cancel_check=cancel_check))
            elif engine == "kokoro":
                chunks = list(self.runtime.kokoro.synthesize_stream(request, cancel_check=cancel_check))
            else:
                raise ValueError("Unsupported TTS engine")
            return {"chunks": chunks}
        if self.path == "/cancel":
            return self.runtime.cancel(request)
        if self.path == "/vad/detect":
            import base64
            payload = dict(request)
            if isinstance(payload.get("pcm"), str):
                payload["pcm"] = base64.b64decode(payload["pcm"])
            return self.runtime.vad.detect(payload)
        raise ValueError("Unknown endpoint")

    def _authorized(self) -> bool:
        token = self.runtime.config.auth_token
        header = self.headers.get("authorization", "")
        return bool(token) and header == f"Bearer {token}"

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length == 0:
            return {}
        body = self.rfile.read(length)
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Expected JSON object")
        return payload

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class VoiceSidecarServer(ThreadingHTTPServer):
    def __init__(self, config: SidecarConfig) -> None:
        if config.host != "127.0.0.1":
            raise ValueError("Voice sidecar must bind to 127.0.0.1")
        super().__init__((config.host, config.port), VoiceRequestHandler)
        self.runtime = VoiceRuntime(config)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Agent-X local voice sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = SidecarConfig(
        host=args.host,
        port=args.port,
        auth_token=os.environ.get("AGENTX_VOICE_AUTH_TOKEN", ""),
        data_dir=os.environ.get("AGENTX_VOICE_DATA_DIR", ""),
    )
    server = VoiceSidecarServer(config)
    print(f"Agent-X voice sidecar ready on {config.host}:{config.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
