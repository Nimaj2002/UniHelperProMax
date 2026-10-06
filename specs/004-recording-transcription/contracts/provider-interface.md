# Backend Contract: Transcription Provider Interface (004)

Constitution IV: every provider implements this one interface; the UI only sees
`GET /transcription/providers` (the declared `ProviderSpec`) and job results. Adding a provider =
one module registered in `transcription/providers.py`; no UI or API change.

## Types (`backend/src/unihelper/transcription/base.py`)

```python
@dataclass(frozen=True)
class ProviderField:
    key: str                 # "address" | "apiKey" | "model" | …
    label: str
    kind: Literal["url", "secret", "text"]
    required: bool
    placeholder: str | None = None

@dataclass(frozen=True)
class ProviderSpec:
    id: str                  # stable, stored in settings and jobs
    name: str                # shown in Settings and job details
    fields: tuple[ProviderField, ...]
    max_upload_bytes: int | None   # None = no per-file limit (one part)

@dataclass(frozen=True)
class AudioPart:
    data: bytes
    file_name: str           # e.g. "Recording 10-02.part2.webm"
    mime_type: str           # audio/webm | audio/mp4
    duration_ms: int

class ProviderConfig(Protocol):
    values: Mapping[str, str]          # non-secret field values (snapshot)
    def secret(self) -> str | None: ...  # read from the database at call time; never cached/logged

Progress = Callable[[float], Awaitable[None]]   # upload fraction 0–1 of this part

class TranscriptionProvider(Protocol):
    spec: ProviderSpec
    async def transcribe(self, part: AudioPart, language: str | None,
                         config: ProviderConfig, on_progress: Progress) -> str: ...
    async def test(self, config: ProviderConfig) -> None: ...   # used by 005 (connection test); raises ProviderError
```

## Errors

```python
class ProviderError(Exception):
    category: Literal["not_configured", "invalid_credentials", "unavailable",
                      "file_rejected", "quota_exceeded", "unknown"]
    message: str              # plain language for the user; built from the category, never
                              # from response bodies/headers; never contains the key
    settings_related: bool    # address unreachable, invalid key, unknown model → link to Settings
    retryable: bool           # transient (rate limit, 502/503/504, reset): retried in-job (B6)
```

`str(ProviderError)` returns `message`; logging uses `category` + provider id + HTTP status only.

## First-release providers

| id | name | fields | auth | max_upload_bytes |
|---|---|---|---|---|
| `voice-studio` | Voice Studio | `address` (url, required), `model` (text, optional, default `whisper-1`) | none | none |
| `openai-compatible` | OpenAI-compatible | `address` (url, required), `apiKey` (secret, required), `model` (text, required) | `Authorization: Bearer` | 25 MB |

Both use `OpenAITranscriptionClient`: `POST {base}/v1/audio/transcriptions`, multipart
`file`, `model`, `language` (omitted for `auto`), `response_format=json`; result `text`
(trimmed). Base normalisation: strip trailing `/` and a trailing `/v1`.

Connection test (005): `GET {base}/v1/models`; when the server lists models, the configured
model must be among them. If `/v1/models` doesn't exist (404/405/501 — common for local servers
such as Voice Studio), the test POSTs an empty form to `/v1/audio/transcriptions`: a validation
error (400/415/422) proves the endpoint exists (no audio is sent); 404/405 means the server isn't
a transcription service; 401/403 means the key was rejected. The model name can't be verified in
that case.

## Rules for implementations

- Never write audio, keys or responses to disk or logs.
- Read the secret via `config.secret()` immediately before each request; if it returns
  `None` for a provider that needs one → `ProviderError("invalid_credentials", settings_related=True)`.
- Honour cancellation (`asyncio.CancelledError` propagates; close the request).
- Return `""` for no speech; the service writes "(No speech detected)".
