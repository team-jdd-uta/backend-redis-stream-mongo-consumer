# Redis Stream -> MongoDB

## What this adds
- A terminal-driven producer that publishes lines into Redis Stream.
- Consumer (`src/app.js`) reads from the stream and saves to MongoDB.
- Consumer batches inserts every 1 second (default).
- Terminal producer sends 1000 messages per input (default).
- Docker image + Compose 기반 consumer 실행 지원 (외부 env 파일 주입).

## Prerequisites
- Redis and MongoDB running (Docker recommended).
- `.env` configured (see existing `.env`).

## Run

```powershell
# terminal 1: consumer
node src/app.js
```

```powershell
# terminal 2: interactive producer
node src/tools/streamProducer.js
```

### Input formats
- Plain text: sends as `comment` with `user_id=terminal`, `room_id=0`.
- JSON: `{"user_id":"u1","comment":"hi","room_id":42}`

## Verify

```powershell
node check-data.js
```

## Optional batching env

```env
BATCH_INTERVAL_MS=1000
MAX_BATCH_SIZE=500
BULK_COUNT=1000
```

## Docker Compose Run

```bash
# 1) 필요 시 외부 설정 파일 생성/수정
cp consumer.env.example consumer.env
```

```bash
# 2) Redis + MongoDB + Consumer를 한 번에 실행
docker compose up -d --build
```

```bash
# 3) Consumer 로그 확인
docker compose logs -f consumer
```

`consumer.env`에서 `READ_BLOCK_MS`, `BATCH_INTERVAL_MS` 등 모든 consumer env 값을 수정할 수 있습니다.

GitOps push test marker for CI verification.
