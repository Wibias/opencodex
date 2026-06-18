# 01 — 아키텍처 옵션 비교

> 작성: 2026-06-18 · 목적: opencodex의 최적 아키텍처 결정을 위한 선택지 분석

## 제약 조건

1. **인바운드**: Codex 클라이언트가 보내는 `/v1/responses` 요청 (SSE 스트리밍)
2. **아웃바운드**: 다양한 프로바이더의 `/v1/chat/completions` (또는 네이티브 API)
3. **목표**: `npx opencodex` 한 줄로 실행 가능한 경량 프록시
4. **GUI 확장**: 설정/모니터링용 웹 대시보드

## 옵션 A: Minimal Standalone (단일 파일 프록시)

```
opencodex (single binary/script)
├── /v1/responses  ← Codex 인바운드
│   ├── parseRequest()      ← Responses → Context
│   ├── toChatCompletions() ← Context → Chat API 요청
│   ├── fetch(provider)     ← 프로바이더 호출
│   └── encodeStream()      ← 응답 → Responses SSE
└── config.toml             ← 프로바이더 URL/키 설정
```

- **장점**: 최소 코드 (~500줄), 의존성 0 (Node.js only), 즉시 배포
- **단점**: Chat Completions만 지원, 확장성 없음
- **GUI**: 별도 구현 필요

## 옵션 B: Plugin Adapter Architecture

```
opencodex/
├── core/
│   ├── server.ts           ← HTTP 서버 + SSE
│   ├── responses-parser.ts ← parseRequest (jawcode 추출)
│   ├── responses-encoder.ts← encodeStream (jawcode 추출)
│   └── types.ts            ← 내부 Context 타입
├── adapters/
│   ├── openai-chat.ts      ← Chat Completions 어댑터 (Tier 1)
│   ├── anthropic.ts        ← Anthropic Messages 어댑터 (Tier 2)
│   ├── google.ts           ← Google AI 어댑터 (Tier 2)
│   └── passthrough.ts      ← Responses API 패스스루 (Tier 2)
├── gui/
│   ├── dashboard.html      ← 단일 파일 SPA
│   └── api.ts              ← 설정/모니터링 API
└── config.toml
```

- **장점**: 확장 가능, 커뮤니티 어댑터 기여 가능, 관심사 분리
- **단점**: 초기 구현량 더 많음 (~1,500줄)
- **GUI**: core에 내장 가능 (단일 HTML serve)

## 옵션 C: jawcode auth-gateway Fork (풀 추출)

```
opencodex/
├── gateway/                ← jawcode auth-gateway 전체 포크
│   ├── server.ts
│   ├── openai-responses-server.ts
│   ├── openai-chat-server.ts
│   ├── anthropic-messages-server.ts
│   └── ...
├── providers/              ← jawcode providers 전체 포크
│   ├── anthropic.ts
│   ├── google.ts
│   ├── ollama.ts
│   └── ...
└── gui/
```

- **장점**: 즉시 46 프로바이더 전체 지원, 검증된 코드
- **단점**: 거대한 의존성 (pi-ai 전체), jawcode와 동기화 부담, 라이선스 이슈
- **GUI**: jawcode의 기존 UI 코드 활용 가능

## 추천: 옵션 B (Plugin Adapter)

### 이유

1. **빠른 MVP**: Tier 1 (Chat Completions) 어댑터만 구현하면 ~80% 커버
2. **점진적 확장**: 어댑터 추가로 Tier 2/3 점진 지원
3. **GUI 친화**: 어댑터 목록/상태를 GUI에서 관리하기 자연스러움
4. **오픈소스 기여**: 커뮤니티가 어댑터를 만들기 쉬운 인터페이스
5. **jawcode 의존성 최소화**: 핵심 변환 로직만 추출 (openai-responses-server.ts)

### 어댑터 인터페이스 (초안)

```typescript
interface ProviderAdapter {
  name: string;
  supportedApis: string[];
  
  // Context → 프로바이더 네이티브 요청
  buildRequest(context: Context, options: AdapterOptions): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  
  // 프로바이더 SSE 스트림 → 내부 이벤트 스트림
  parseStream(response: Response): AsyncIterable<InternalEvent>;
}
```

## GUI 아키텍처 옵션

### G1: 내장 단일 파일 SPA
- `gui/index.html` — Tailwind CDN + Alpine.js, 프록시 서버가 직접 serve
- 설정 편집, 실시간 요청 로그, 프로바이더 상태
- **장점**: 추가 빌드 불필요, `npx opencodex` 실행 시 자동 접근
- **단점**: 복잡한 UI 구현 한계

### G2: Vite + React SPA (별도 빌드)
- 프록시와 별도 포트 또는 내장
- **장점**: 풍부한 UI, 실시간 차트, 로그 뷰어
- **단점**: 빌드 스텝 필요, 패키지 크기 증가

### G3: TUI (Terminal UI)
- Ink(React for CLI) 또는 blessed 기반
- **장점**: npm 패키지 크기 최소, 서버리스
- **단점**: 접근성 낮음

### 추천: G1 (내장 SPA) → G2 (점진 확장)
MVP에서는 단일 HTML로 시작, 나중에 별도 빌드로 확장.

## 기술 스택 결정 사항 (Interview에서 확인 필요)

1. **런타임**: Bun vs Node.js? (jawcode는 Bun 사용)
2. **HTTP 서버**: 내장 Bun.serve / Node http / Hono / Fastify?
3. **패키지 배포**: npm (npx) vs standalone binary (pkg/bun compile)?
4. **설정 포맷**: TOML (Codex 호환) vs JSON vs YAML?
5. **라이선스**: MIT vs Apache 2.0?
6. **모노레포 vs 단일 패키지**: 어댑터를 별도 패키지로?
7. **테스트 전략**: Vitest? 실제 프로바이더 mock?
