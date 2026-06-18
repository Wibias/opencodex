# 00 — jawcode 프로바이더 전수조사

> 작성: 2026-06-18 · 목적: opencodex 프록시에서 지원 가능한 프로바이더/API 분류

## jawcode 아키텍처 요약

jawcode의 `auth-gateway`는 3개의 인바운드 와이어 포맷을 받아 내부 `Context`로 변환하고, `streamSimple()`을 통해 12개 아웃바운드 프로토콜로 디스패치하는 프로토콜 번역기.

```
인바운드 (클라이언트 → 게이트웨이):
  POST /v1/chat/completions  → openai-chat-server.ts
  POST /v1/messages          → anthropic-messages-server.ts
  POST /v1/responses         → openai-responses-server.ts

아웃바운드 (게이트웨이 → 프로바이더):
  streamSimple() → 12개 API별 스트림 함수 디스패치
```

## 12개 Known API (와이어 프로토콜)

| # | API | 스트림 함수 | 프로바이더 수 | 모델 수 |
|---|-----|------------|-------------|---------|
| 1 | `openai-completions` | `streamOpenAICompletions` | 30+ | ~2,800+ |
| 2 | `openai-responses` | `streamOpenAIResponses` | 4 | ~128 |
| 3 | `openai-codex-responses` | `streamOpenAICodexResponses` | 1 | 16 |
| 4 | `azure-openai-responses` | `streamAzureOpenAIResponses` | 1 | 5 |
| 5 | `anthropic-messages` | `streamAnthropic` | 8+ | ~300+ |
| 6 | `bedrock-converse-stream` | `streamBedrock` | 1 | 119 |
| 7 | `google-generative-ai` | `streamGoogle` | 1 | 34 |
| 8 | `google-gemini-cli` | `streamGoogleGeminiCli` | 2 | 22 |
| 9 | `google-vertex` | `streamGoogleVertex` | 1 | 13 |
| 10 | `ollama-chat` | `streamOllama` | 1 | 4 |
| 11 | `cursor-agent` | `streamCursor` | 1 | 145 |
| 12 | `kiro-streaming` | `streamKiro` | 1 | (동적) |

## 프로바이더별 API 매핑 (46개)

### openai-completions (30+ 프로바이더) — Chat Completions API
가장 보편적. 거의 모든 로컬/클라우드 프로바이더가 이 규격을 지원.

| 프로바이더 | 모델 수 | 비고 |
|-----------|---------|------|
| alibaba-coding-plan | 12 | 알리바바 코딩 |
| cerebras | 6 | 초고속 추론 |
| deepseek | 2 | DeepSeek V3/R1 |
| firepass | 1 | |
| fireworks | 7 | Fireworks AI |
| groq | 18 | 초저지연 |
| huggingface | 4 | HF Inference |
| kilo | 453 | 다중 모델 게이트웨이 |
| kimi-code | 4 | Moonshot Kimi |
| litellm | 821 | LiteLLM 프록시 (최대) |
| minimax-code | 10 | MiniMax 코드 |
| minimax-code-cn | 10 | MiniMax 코드 (중국) |
| mistral | 29 | Mistral AI |
| moonshot | 1 | |
| nanogpt | 688 | NanoGPT |
| nvidia | 89 | NVIDIA NIM |
| openrouter | 341 | OpenRouter |
| qianfan | 1 | 바이두 |
| qwen-portal | 2 | 알리바바 Qwen |
| synthetic | 21 | 테스트용 |
| together | 8 | Together AI |
| venice | 108 | Venice AI |
| xai | 30 | xAI Grok |

### anthropic-messages (8+ 프로바이더)
| 프로바이더 | 모델 수 | 비고 |
|-----------|---------|------|
| anthropic | 24 | Anthropic 직접 |
| cloudflare-ai-gateway | 38 | CF AI Gateway |
| minimax | 9 | MiniMax |
| minimax-cn | 9 | MiniMax (중국) |
| vercel-ai-gateway | 190 | Vercel AI Gateway |
| xiaomi | 6 | 샤오미 |
| zai | 14 | Zai |
| zenmux (일부) | — | 혼합 프로토콜 |

### 멀티프로토콜 프로바이더
| 프로바이더 | API 목록 | 모델 수 |
|-----------|----------|---------|
| github-copilot | anthropic + completions + responses | 31 |
| gitlab-duo | anthropic + completions + responses | 16 |
| opencode | completions + responses | 5 |
| opencode-go | anthropic + completions | 18 |
| opencode-zen | anthropic + google + completions + responses | 62 |
| zenmux | anthropic + completions | 173 |

### 전용 프로토콜
| 프로바이더 | API | 모델 수 | 비고 |
|-----------|-----|---------|------|
| openai | openai-responses | 43 | OpenAI 네이티브 |
| openai-codex | openai-codex-responses | 16 | Codex 전용 (WebSocket) |
| azure-openai | azure-openai-responses | 5 | Azure |
| amazon-bedrock | bedrock-converse-stream | 119 | AWS SigV4 + EventStream |
| google | google-generative-ai | 34 | Google AI Studio |
| google-antigravity | google-gemini-cli | 15 | Cloud Code Assist |
| google-gemini-cli | google-gemini-cli | 7 | Gemini CLI |
| google-vertex | google-vertex | 13 | Vertex AI |
| ollama-cloud | ollama-chat | 4 | Ollama |
| cursor | cursor-agent | 145 | Cursor 독점 (Protobuf) |

## opencodex에서 지원 가능 여부 분류

### ✅ Tier 1 — 즉시 지원 (프록시 핵심)
Responses API ↔ Chat Completions 변환만으로 커버.

| API | 커버 프로바이더 | 예상 난이도 | 비고 |
|-----|---------------|-----------|------|
| `openai-completions` | 30+ 프로바이더, ~2,800 모델 | 낮음 | messages/tools 1:1 매핑 |
| `ollama-chat` | Ollama | 낮음 | Chat Completions 호환 |

**이것만으로 전체 사용 사례의 ~80% 커버.**
Ollama, LM Studio, vLLM, Groq, Together, Fireworks, OpenRouter, Mistral, DeepSeek, xAI 등 모두 포함.

### ✅ Tier 2 — 중간 노력으로 지원 가능
jawcode에서 변환 로직 추출 필요.

| API | 커버 프로바이더 | 예상 난이도 | 비고 |
|-----|---------------|-----------|------|
| `anthropic-messages` | Anthropic, CF Gateway, Vercel 등 | 중간 | 메시지 구조 차이 큼, 但 jawcode에 완전한 변환기 있음 |
| `google-generative-ai` | Google AI Studio | 중간 | 독자 포맷이지만 jawcode에 변환기 있음 |
| `openai-responses` | OpenAI 네이티브 | 없음 | 패스스루 (동일 프로토콜) |
| `azure-openai-responses` | Azure OpenAI | 낮음 | openai-responses + Azure 인증 |

### ⚠️ Tier 3 — 복잡하거나 제한적
| API | 난이도 | 이유 |
|-----|--------|------|
| `bedrock-converse-stream` | 높음 | AWS SigV4 서명 + EventStream 바이너리 프레이밍 |
| `google-vertex` | 중간-높음 | Google OAuth + 커스텀 엔드포인트 |
| `google-gemini-cli` | 높음 | 전용 CLI 프로토콜, 일반 사용자 대상 아님 |

### ❌ Tier 4 — 지원 불가/불필요
| API | 이유 |
|-----|------|
| `openai-codex-responses` | 이것이 Codex 클라이언트 프로토콜 자체 (프록시 인바운드) |
| `cursor-agent` | Protobuf 기반 독점 프로토콜, Cursor 내부 전용 |
| `kiro-streaming` | Amazon Kiro 내부 전용 |

## jawcode에서 추출할 핵심 소스 파일

| 파일 | 줄 수 | 역할 | 추출 난이도 |
|------|------|------|-----------|
| `openai-responses-server.ts` | 1,190 | Responses ↔ 내부 Context 변환 (parseRequest + encodeStream) | 중간 — Zod 스키마 의존 |
| `openai-responses-server-schema.ts` | ? | Responses API Zod 스키마 | 낮음 — 독립적 |
| `openai-chat-server.ts` | ? | Chat Completions ↔ 내부 Context | 중간 |
| `openai-chat-server-schema.ts` | ? | Chat Completions Zod 스키마 | 낮음 |
| `anthropic-messages-server.ts` | ? | Anthropic Messages ↔ 내부 Context | 중간 |
| `auth-gateway/server.ts` | ? | HTTP 서버 + 라우팅 | 높음 — AuthStorage 의존 |
| `auth-gateway/types.ts` | 135 | 공통 타입 (ParsedRequest 등) | 낮음 |
| `stream.ts` | ? | Provider dispatch + options 빌드 | 높음 — 전체 pi-ai 의존 |
| `transform-messages.ts` | ? | 메시지 포맷 변환 유틸 | 중간 |

## 결론

**Phase 1 (MVP)**: `openai-completions` 타깃만으로 30+ 프로바이더, 2,800+ 모델 즉시 커버.
jawcode에서 `openai-responses-server.ts`의 parseRequest/encodeStream + 간단한 Chat Completions 클라이언트만 추출하면 됨.
예상 코드량: ~800줄.

**Phase 2**: Anthropic Messages, Google AI 어댑터 추가.
**Phase 3**: Bedrock, Vertex 등 엔터프라이즈 프로바이더.
