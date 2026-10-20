# Contract: Provider Adapters (outbound wire formats)

All three styles sit behind one backend interface, `unihelper/ai/base.py`, so adding a fourth
style needs no UI change:

```text
ChatAdapter
  list_models(cfg)                -> list[DiscoveredModel]      # raises AiError(category)
  probe(cfg, model_id)            -> None                       # minimal request when no model list
  stream(cfg, request)            -> AsyncIterator[Delta | Usage | End]
  classify(response|exception)    -> AiError
```

- `request` is style-neutral: the system text, then a list of
  `{role: user|assistant, parts: [Text | Image | Pdf | PdfText | Audio | NoteText]}`.
- Each adapter maps it as shown below. The adapter re-checks the https rule (research R5) before
  it attaches any key.
- These formats were confirmed on 2026-10-19 (research R3). Where the docs differ from the spec's
  table, the docs win.

## OpenAI-compatible

| | |
|---|---|
| Chat | `POST {base}/chat/completions` |
| Models | `GET {base}/models` → `{data:[{id, object:"model"}]}` |
| Key | `Authorization: Bearer <key>`, sent only when a key exists |
| Body | `{model, messages:[{role:"system"\|"user"\|"assistant", content}], stream:true, stream_options:{include_usage:true}}` |
| Text part | `{type:"text", text}` (a plain string when the message is text only, for older local servers) |
| Image | `{type:"image_url", image_url:{url:"data:<mime>;base64,<b64>"}}` |
| PDF | `{type:"file", file:{filename, file_data:"data:application/pdf;base64,<b64>"}}` |
| Audio | `{type:"input_audio", input_audio:{data:<b64>, format:"wav"\|"mp3"}}` |
| Stream | `data: {choices:[{delta:{content}}]}`. Usage is in a last chunk with empty `choices`. The stream ends with `data: [DONE]` |
| Errors | `{error:{message,type,code}}`. Classified as: 401 → key_rejected; 404 or code `model_not_found` → model_not_found; 413 → too_large; 429 → rate_limited (`retry-after`); `context_length_exceeded` → context_exceeded |

## Anthropic

| | |
|---|---|
| Chat | `POST {base}/v1/messages` |
| Models | `GET {base}/v1/models?limit=100`, paginated with `after_id`. Response: `{data:[{id, type:"model", display_name, max_input_tokens?, max_tokens?}], has_more, last_id}` |
| Key | `x-api-key: <key>` and `anthropic-version: 2023-06-01` |
| Body | `{model, max_tokens, system?, messages:[{role:"user"\|"assistant", content:[blocks]}], stream:true}`. Consecutive messages with the same role are merged so roles alternate |
| Image | `{type:"image", source:{type:"base64", media_type, data}}`. Types: jpeg, png, gif, webp |
| PDF | `{type:"document", source:{type:"base64", media_type:"application/pdf", data}}` |
| Audio | Not accepted. The capability is forced off, and the switch is disabled with the reason |
| Stream | `message_start`; `content_block_start`; `content_block_delta` (`text_delta` is used, `thinking_delta` is ignored); `content_block_stop`; `message_delta` (stop_reason, usage); `message_stop`. `ping` is ignored. An `error` event becomes a classified failure |
| Errors | `{type:"error", error:{type,message}}`. Classified as: authentication_error/permission_error → key_rejected; not_found_error → model_not_found; request_too_large (413) → too_large; rate_limit_error (429, `retry-after`) → rate_limited; overloaded_error (529) → provider "busy, try again" |
| Limits | 32 MB per request; images ≤ 10 MB base64, at most 100; PDFs ≤ 100 pages (600 for models with a context of 1M or more) |

## Google Gemini

| | |
|---|---|
| Chat | `POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse` |
| Models | `GET {base}/v1beta/models?pageSize=1000`, paginated with `pageToken`. Response: `{models:[{name:"models/…", displayName, inputTokenLimit, outputTokenLimit, supportedGenerationMethods}]}`. Only models that support `generateContent` are kept, and `models/` is stripped from the name to give `modelId` |
| Key | `x-goog-api-key: <key>` |
| Body | `{contents:[{role:"user"\|"model", parts:[{text}\|{inline_data:{mime_type,data}}]}], system_instruction?:{parts:[{text}]}, generationConfig:{maxOutputTokens}}` |
| Image | `inline_data`: png, jpeg, webp, heic, heif. GIF is refused |
| PDF | `inline_data` `application/pdf` |
| Audio | `inline_data`: wav, mp3, aiff, aac, ogg, flac. WebM/Opus recordings are remuxed to `audio/ogg` (research R9) |
| Stream | Each `data:` line is a full response: `candidates[0].content.parts[].text`, skipping parts with `thought:true`. `usageMetadata` gives usage. `finishReason` is on the last chunk. There is no `[DONE]` marker; the stream simply ends |
| Errors | `{error:{code,status,message,details}}`. Classified as: 401/403 `PERMISSION_DENIED`/`UNAUTHENTICATED` → key_rejected; 404 → model_not_found; 429 `RESOURCE_EXHAUSTED` → rate_limited (`RetryInfo.retryDelay` when present); 400 mentioning size → too_large; `finishReason: SAFETY` → provider "The provider blocked this answer" |
| Limits | 20 MB of inline data per request (research R3 explains why this conservative figure is used); PDFs ≤ 1,000 pages |

## Shared behaviour

- **Timeouts**: connect 10 s; first byte 120 s; 120 s between chunks after that (the read
  timeout).
- **Redirects**: not followed when a key header is present.
- **Retries**: there are no automatic retries during streaming. The user retries from the failed
  message (FR-039).
