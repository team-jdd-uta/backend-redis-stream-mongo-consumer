# backend-redis-stream-mongo-consumer

Redis Stream에 쌓인 채팅 메시지를 읽어 MongoDB에 저장하는 Node.js consumer입니다. `backend-chat-service`가 `chat:stream:room:{roomId}`에 append한 메시지를 consumer group으로 읽고, MongoDB `comment` collection에 저장합니다.

Kafka outbox consumer가 아닙니다. Kafka 회원가입 이벤트는 `backend-user-service`가 직접 소비합니다.

## 역할

- Redis Stream key pattern을 주기적으로 스캔합니다.
- 각 stream에 consumer group을 생성합니다.
- 새 메시지를 batch로 읽어 MongoDB에 저장합니다.
- 저장 후 Redis Stream message를 ACK 처리합니다.
- 컨테이너 readiness 확인을 위해 준비 파일을 생성합니다.

## 기술 스택

- Node.js 20
- Redis Streams
- MongoDB / Mongoose
- Docker / Docker Compose

## 입력 Stream

기본 pattern:

```text
chat:stream:room:*
```

`backend-chat-service`가 저장하는 field 예:

```json
{
  "type": "TALK",
  "roomId": "room-id",
  "sender": "alice",
  "msgId": "optional-message-id",
  "message": "hello",
  "publishedAt": "1714000000000"
}
```

기존 테스트 producer의 field도 일부 수용합니다.

## MongoDB 저장 모델

Mongoose model:

```text
src/models/Comment.js
```

주요 field:

- `user_id`
- `comment`
- `room_id`
- `createdAt`

`src/services/commentService.js`에서 Java producer field와 기존 Node producer field를 모두 MongoDB comment document로 변환합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `MONGO_URI` | 없음 | MongoDB connection string |
| `REDIS_URL` | 없음 | Redis connection string |
| `STREAM_PATTERN` | `chat:stream:room:*` | 소비할 Redis Stream key pattern |
| `STREAM_KEY` | 없음 | 단일 stream key fallback |
| `GROUP_NAME` | 없음 | Redis consumer group |
| `CONSUMER_NAME` | 없음 | Redis consumer name |
| `DISCOVERY_INTERVAL_MS` | `3000` | stream discovery 주기 |
| `BATCH_INTERVAL_MS` | `1000` | batch flush 주기 |
| `MAX_BATCH_SIZE` | `500` | batch 최대 크기 |
| `READ_COUNT` | `100` | XREADGROUP count |
| `READ_BLOCK_MS` | `5000` | XREADGROUP block 시간 |
| `READINESS_FILE_PATH` | OS temp의 `consumer-ready` | readiness 파일 경로 |

예시는 `consumer.env.example`을 참고합니다.

## Docker Compose 실행

```bash
cp consumer.env.example consumer.env
docker compose up -d --build
docker compose logs -f consumer
```

Compose에는 Redis, MongoDB, consumer가 포함되어 있습니다.

## 로컬 실행

Redis와 MongoDB가 먼저 떠 있어야 합니다.

```bash
npm install
node src/app.js
```

테스트 producer:

```bash
node src/tools/streamProducer.js
```

저장 데이터 확인:

```bash
node src/tools/check-data.js
```

## Docker 이미지 빌드

```bash
docker build -t team9-redis-stream-mongo-consumer:local .
```

## Kubernetes 기준

- `MONGO_URI`는 `mongodb://mongodb:27017/commentdb` 형태로 주입합니다.
- `REDIS_URL`은 Redis Stream 전용 Redis service를 가리킵니다.
- readinessProbe는 `/tmp/consumer-ready` 같은 파일 존재 여부를 확인할 수 있습니다.

## 주의점

- Redis Stream key가 동적으로 생기므로 wildcard discovery가 필요합니다.
- 메시지는 batch 저장 후 ACK됩니다. 저장 실패 시 pending message가 남을 수 있습니다.
- `consumer.env`는 로컬 실행 편의 파일입니다. 운영 비밀값은 Kubernetes Secret으로 분리해야 합니다.
