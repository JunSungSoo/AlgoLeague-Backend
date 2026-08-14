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

## 배포: 전용 샌드박스 실행 노드

운영 환경의 채점 코드는 API/DB 노드가 아닌 별도 VM 또는 전용 실행 노드에서만 실행합니다. 메인 `docker-compose.yml`은 `SANDBOX_SERVICE_URL`을 통해 이 노드에 요청하며 Docker 소켓을 마운트하지 않습니다.

전용 노드에는 이 저장소와 Docker만 배포하고, `.env.sandbox.example`을 복사해 샌드박스 전용 토큰과 Docker 소켓 그룹 ID만 설정합니다. `DATABASE_URL`, `REDIS_URL`, OpenAI/OpenRouter 키 등 애플리케이션 자격증명은 이 노드에 복사하지 않습니다.

```bash
cp .env.sandbox.example .env.sandbox
docker compose --env-file .env.sandbox -f docker-compose.sandbox-node.yml up -d --build
```

기본 바인딩은 `127.0.0.1:4100`입니다. WireGuard/Tailscale 같은 비공개 망 또는 상호 TLS 프록시를 앞에 두고, 메인 배포의 `SANDBOX_SERVICE_URL`에는 해당 비공개 HTTPS 주소를 지정합니다. 4100 포트를 공용 인터넷에 직접 노출하면 안 됩니다.

실행 노드 준비 시 `python:3.14.6-slim`, `eclipse-temurin:25-jdk`, `node:24.18.0-bookworm-slim`, `gcc:15.3` 이미지를 미리 받아두고 이후 호스트 방화벽으로 불필요한 아웃바운드를 차단합니다. 개별 채점 컨테이너에는 항상 `--network none`이 적용됩니다.

각 실행은 고유 이름의 새 컨테이너에서 처리되며 종료 후 폐기됩니다. 컨테이너에는 DB/Redis/AI 환경변수가 전달되지 않고, 읽기 전용 루트 파일시스템, non-root 사용자, CPU·메모리·PID·파일 크기 제한, capability 제거, `no-new-privileges`가 적용됩니다. 벽시계 제한이나 출력 제한을 넘으면 오케스트레이터가 해당 컨테이너를 강제로 삭제합니다.

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
