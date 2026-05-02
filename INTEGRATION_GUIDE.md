# Redis Stream MongoDB Consumer + AI Summary Integration

이 서비스는 Redis Stream에서 실시간 채팅 메시지를 읽어 MongoDB에 저장하고, 500건 단위로 자동 요약을 생성하는 마이크로서비스입니다.

## 아키텍처

```
Redis Stream (chat:stream:room:*)
    ↓
[Consumer] 
    ├→ MongoDB: Comment Collection (메시지 저장)
    └→ HTTP Request to Summary Service
        ↓
    [AI Chat Summary Service] (OpenAI API)
        ↓
    MongoDB: Summary Collection (요약 저장)
```

## 핵심 기능

### 1. 메시지 수집 (Redis Stream → MongoDB Comment)
- Redis Stream에서 패턴 기반으로 방 스트림 자동 감지
- Consumer Group으로 분산 처리 지원
- 배치 저장으로 성능 최적화

### 2. 자동 요약 생성 (매 500메시지)
- 배치 크기가 500을 넘으면 자동으로 요약 요청
- 방(room) 별로 독립적으로 요약 생성
- 요약 실패 시에도 메시지 저장은 정상 처리 (graceful degradation)

### 3. 요약 조회 API
- `GET /api/summaries/:roomId` - 최신 요약 조회
- `/health` - 헬스 체크 엔드포인트

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
```bash
cp consumer.env.example consumer.env
```

`consumer.env` 파일에서 다음을 수정하세요:
```env
# MongoDB 연결
MONGO_URI=mongodb://mongodb:27017/commentdb

# Redis 연결
REDIS_URL=redis://redis:6379

# Summary Service URL (AI Chat Summary 서비스)
SUMMARY_SERVICE_URL=http://ai-chat-summary:8000

# 500건 단위로 요약 생성
SUMMARY_BATCH_SIZE=500
```

### 3. Docker Compose로 실행
```bash
docker-compose up -d
```

### 4. 필수 조건: AI Chat Summary 서비스
별도로 `../AI-chat-summery/` 디렉토리에서 서비스를 실행해야 합니다:

```bash
cd ../AI-chat-summery
docker build -t ai-chat-summary:latest .
docker run -d -p 8000:8000 --env-file .env ai-chat-summary:latest
```

또는 docker-compose에 ai-chat-summary를 추가할 수 있습니다.

## 환경 변수 상세

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `MONGO_URI` | - | MongoDB 연결 문자열 |
| `REDIS_URL` | - | Redis 연결 문자열 |
| `STREAM_PATTERN` | `chat:stream:room:*` | Redis Stream 패턴 |
| `GROUP_NAME` | - | Consumer Group 이름 |
| `CONSUMER_NAME` | - | Consumer 이름 |
| `SUMMARY_SERVICE_URL` | `http://localhost:8000` | AI 요약 서비스 주소 |
| `SUMMARY_BATCH_SIZE` | `500` | 요약 트리거 메시지 수 |
| `SUMMARY_SERVICE_TIMEOUT_MS` | `30000` | 요약 서비스 타임아웃 (ms) |
| `PORT` | `3000` | HTTP 서버 포트 |
| `BATCH_INTERVAL_MS` | `100` | 배치 저장 주기 (ms) |
| `MAX_BATCH_SIZE` | `10000` | 최대 배치 크기 |
| `READ_COUNT` | `100` | 한 번에 읽는 메시지 수 |

## API 엔드포인트

### 헬스 체크
```bash
GET /health
# Response: { "status": "ok" }
```

### 최신 요약 조회
```bash
GET /api/summaries/:roomId
# Response:
# {
#   "_id": "...",
#   "room_id": "room123",
#   "summary": "사용자들이 영화 리뷰를 나누고 배우 연기력에 대해 토론했습니다.",
#   "messageCount": 500,
#   "messageIds": [...],
#   "createdAt": "2024-01-15T10:30:00Z"
# }
```

## 데이터 모델

### Comment Collection
```javascript
{
  user_id: String,
  comment: String,
  room_id: String,
  createdAt: Date
}
```

### Summary Collection
```javascript
{
  room_id: String,          // 방 ID (indexed)
  summary: String,          // OpenAI 요약 (1-2줄)
  messageCount: Number,     // 요약 생성에 포함된 메시지 수
  messageIds: [String],     // 포함된 메시지 ID 목록
  createdAt: Date          // 요약 생성 시간 (indexed)
}
```

## 로그 예시

```
✅ MongoDB 연결 성공
✅ Redis 연결 성공
✅ HTTP 서버 시작: port 3000
🚀 Comment Consumer 시작 중...
📌 STREAM_PATTERN: chat:stream:room:*
📌 GROUP_NAME: comment-group
📌 CONSUMER_NAME: comment-worker-1

✅ 배치 저장 및 ACK 완료: 100건 (저장 45.23 ms, ACK 12.34 ms, interval)
📊 요약 생성 시작: room_id=room123, 메시지수=500
📈 요약 생성 완료: room_id=room123
```

## 트러블슈팅

### 요약 생성 실패
```
⚠️ room_id=room123 요약 생성 실패: Connection refused
```
- **원인**: AI Chat Summary 서비스가 실행 중이지 않음
- **해결**: SUMMARY_SERVICE_URL이 올바른지 확인하고 AI 서비스를 시작하세요

### Redis Stream 명령어 에러
```
Redis Stream 명령어 미지원 - Redis 5.0 이상 필요
```
- **원인**: Redis 버전이 5.0 미만
- **해결**: Redis 5.0 이상으로 업그레이드하세요

### MongoDB 연결 실패
```
connect ECONNREFUSED 127.0.0.1:27017
```
- **원인**: MongoDB가 실행 중이지 않음
- **해결**: MongoDB를 시작하고 MONGO_URI를 확인하세요

## 성능 최적화

### 배치 크기 조정
- `MAX_BATCH_SIZE`: 메모리 사용량과 처리량의 트레이드오프
  - 낮은 값: 메모리 절약, 처리량 감소
  - 높은 값: 처리량 증가, 메모리 사용량 증가

### 요약 배치 크기
- `SUMMARY_BATCH_SIZE`: 요약 생성 빈도
  - 낮은 값: 빠른 요약, API 호출 증가
  - 높은 값: API 호출 감소, 요약 지연

### 타임아웃 설정
- `SUMMARY_SERVICE_TIMEOUT_MS`: 느린 네트워크에서는 증가
  - AI API 응답 시간에 따라 조정 (기본 30초)

## 모니터링

### 메시지 처리량
```bash
# 로그에서 초당 처리량 계산
# "배치 저장 및 ACK 완료: 500건" 로그로 처리량 추적
```

### 요약 생성 현황
```bash
# MongoDB에서 직접 조회
db.summaries.find({}).sort({ createdAt: -1 }).limit(10)
```

## 개발자 가이드

### 새로운 Consumer 추가
```javascript
// commentConsumer.js에서 새로운 로직 추가
const handleCustomLogic = async (batch) => {
    // 맞춤 처리 로직
};
```

### 요약 서비스 교체
```javascript
// summaryServiceClient.js에서 다른 API로 변경
const response = await http.post('/custom-endpoint', payload);
```

## 라이선스
ISC
