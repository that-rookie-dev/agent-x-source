# Agent-X Voice Sidecar

Local Python sidecar for strictly-local Agent-X voice support.

The Node engine starts this process on demand through `VoiceSidecarManager`. It
must bind only to `127.0.0.1` and every request must include the bootstrap bearer
token passed through `AGENTX_VOICE_AUTH_TOKEN`.

## Runtime Contract

```bash
AGENTX_VOICE_DATA_DIR=/path/to/data/voice \
AGENTX_VOICE_AUTH_TOKEN=<random-token> \
python -m agentx_voice.server --host 127.0.0.1 --port 45678
```

Endpoints:

- `GET /health`
- `POST /warm`
- `POST /stt/transcribe`
- `POST /tts/synthesize`
- `POST /cancel`

The current scaffold intentionally uses Python stdlib only. Model integration is
added in the next implementation slice:

- STT: faster-whisper
- TTS: Kokoro and StyleTTS 2, selected by `voice.tts.engine`
- VAD: Silero VAD

Kokoro remains the filler voice path for low-latency progress speech. Final
answers use the TTS engine selected by the user in Settings.
