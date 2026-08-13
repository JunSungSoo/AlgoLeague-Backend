# algorithm-champions-back

알고리그의 독립 백엔드 저장소입니다. Fastify API, PostgreSQL/Drizzle 원장, Redis 비동기 작업, 등급·배정 정책, 다언어 Judge와 AI 문제 생성 워커를 소유합니다.

## 개발 실행

```bash
cp .env.example .env
yarn install
docker compose up -d postgres redis
yarn db:migrate
yarn db:seed
yarn dev
```

기본 API 주소는 `http://localhost:4000`입니다. 검증 명령은 `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`입니다.

## 문제 생성 공급자

생성 워커는 `GENERATION_PROVIDERS=openai,openrouter,ollama,rule` 순서로 공급자를 시도합니다. 9~~6급은 무중단·무과금 생성을 위해 `rule`을 우선 사용하고, 5~~2급은 AI 공급자 실패 시 다음 공급자로 넘어갑니다. 모든 문제는 공개 예제와 비공개 테스트에서 Python, Java, JavaScript, C++ 공식답안을 실행한 후 게시됩니다.

- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- Ollama: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- 규칙 기반: 별도 키 없음

기본 생성 주기는 9~~4급 매일, 3~~2급 월·수·금, 1급 일요일입니다. `GENERATION_MEDIUM_WEEKDAYS_KST`와 `GENERATION_ELITE_WEEKDAYS_KST`에서 요일을 조절할 수 있으며 `0`은 일요일입니다. 1급은 AI로만 생성되고 자동 게시되지 않습니다.

## 디렉터리

- `src/http`: Fastify API와 세션·scope 경계
- `src/db`: PostgreSQL 스키마, 마이그레이션, 시드
- `src/domain`: 등급, 배정, 채점, 생성 순수 정책
- `src/services`: 트랜잭션 서비스
- `src/workers`: Judge, AI 생성, 일일 배정·강등 작업
- `drizzle`: 버전 관리되는 SQL 마이그레이션
