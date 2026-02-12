# 🚀 Redis Stream + MongoDB 실행 완벽 가이드

## ⚡ 빠른 시작 (3단계)

### 1단계: Docker 컨테이너 시작

```powershell
cd C:\Users\SKAX\IdeaProjects\untitled
docker-compose down -v    # 이전 설정 완전 초기화
docker-compose up -d      # 새로운 컨테이너 시작
```

**예상 출력:**
```
✔ Container redis-stream   Started
✔ Container mongodb-local  Started
```

### 2단계: npm 의존성 설치 및 Consumer 실행

```powershell
# 터미널 1에서
npm install
node src/app.js
```

**예상 출력:**
```
✅ MongoDB 연결 성공
✅ Redis 연결 성공
📌 Redis 버전: 7.x.x
🚀 Comment Consumer 시작 중...
📌 STREAM_KEY: comment-stream
📌 GROUP_NAME: comment-group
📌 CONSUMER_NAME: comment-worker-1
✅ Consumer Group 생성 완료
🔄 Consumer 시작: 메시지 대기 중...
```

### 3단계: 테스트 메시지 발행

```powershell
# 터미널 2에서
node producer.js
```

**예상 출력:**
```
✅ Redis 연결됨
[1/3] 메시지 발행 중...
✅ 메시지 발행 성공: 1739254800000-0
📝 데이터: { user_id: 'user123', comment: '좋아요!', room_id: 42 }
[2/3] 메시지 발행 중...
✅ 메시지 발행 성공: 1739254800500-0
[3/3] 메시지 발행 중...
✅ 메시지 발행 성공: 1739254801000-0
✅ 모든 메시지 발행 완료!
```

### 터미널 1에서 메시지 처리 확인

```
📨 수신된 메시지: 1개 스트림
📥 메시지 처리 중 (ID: 1739254800000-0)
   데이터: { user_id: 'user123', comment: '좋아요!', room_id: '42', createdAt: '2026-02-11T...' }
✅ 저장 및 ACK 완료: 1739254800000-0
```

---

## 🔍 데이터 확인

### MongoDB에서 저장된 데이터 확인

```powershell
# 터미널 3에서
docker-compose exec mongodb mongosh
```

```mongo
use commentdb
db.comments.find().pretty()
```

**출력 예시:**
```javascript
{
  _id: ObjectId("..."),
  user_id: "user123",
  comment: "좋아요!",
  room_id: "42",
  createdAt: ISODate("2026-02-11T10:00:00.000Z")
}
```

---

## 📊 시스템 구조

```
┌─────────────────┐
│  Producer Node  │  (node producer.js)
│   메시지 발행    │
└────────┬────────┘
         │ XADD
         ▼
┌──────────────────────┐
│  Redis Stream        │  (comment-stream)
│  Stream Key Group    │  (comment-group)
└────────┬─────────────┘
         │ xReadGroup
         ▼
┌──────────────────────┐
│  Consumer Node       │  (node src/app.js)
│  댓글 처리 및 저장    │
└────────┬─────────────┘
         │ saveComment()
         ▼
┌──────────────────────┐
│  MongoDB             │  (commentdb)
│  Comment 컬렉션      │
└──────────────────────┘
```

---

## 🛠️ 문제 해결

### 1. "unknown command 'XGROUP'" 에러

**원인:** Redis 버전이 5.0 미만

**해결책:**
```powershell
# 컨테이너 완전 초기화
docker-compose down -v
docker-compose up -d

# Redis 버전 확인
docker-compose exec redis redis-cli INFO server | grep redis_version
```

### 2. "MongoDB 연결 실패" 에러

**확인:**
```powershell
docker-compose ps  # mongodb-local 상태 확인
docker-compose logs mongodb  # MongoDB 로그 확인
```

### 3. 메시지가 저장되지 않음

**Consumer 로그 확인:**
- "❌ DB 저장 실패" 메시지가 있는지 확인
- "❌ Stream 처리 에러" 메시지 확인

**스트림 상태 확인:**
```powershell
docker-compose exec redis redis-cli
> XLEN comment-stream          # 스트림의 메시지 개수
> XINFO GROUPS comment-stream  # Consumer Group 정보
> XPENDING comment-stream comment-group  # 대기 중인 메시지
```

---

## 📝 파일 설명

| 파일 | 설명 |
|------|------|
| `src/app.js` | 애플리케이션 진입점 (MongoDB, Redis 연결) |
| `src/config/redis.js` | Redis 클라이언트 설정 |
| `src/config/mongoDB.js` | MongoDB 설정 (선택사항) |
| `src/models/Comment.js` | Comment MongoDB 스키마 |
| `src/services/commentService.js` | 댓글 저장 로직 |
| `src/streams/commentConsumer.js` | Redis Stream Consumer |
| `producer.js` | 테스트 메시지 발행 스크립트 |
| `test-redis.js` | Redis Stream 명령어 테스트 |
| `.env` | 환경 변수 (MONGO_URI, REDIS_URL, STREAM_KEY 등) |
| `docker-compose.yml` | Docker 컨테이너 설정 |

---

## 🔧 고급 설정

### 1. Redis Persistence 활성화

`docker-compose.yml`에서 Redis 명령어 수정:

```yaml
command: redis-server --appendonly yes
```

### 2. Consumer 추가 확장

`commentConsumer.js`에서 `CONSUMER_NAME` 변경:

```javascript
const CONSUMER_NAME = `comment-worker-${process.env.WORKER_ID || 1}`;
```

그 후 여러 터미널에서 실행:
```powershell
WORKER_ID=1 node src/app.js
WORKER_ID=2 node src/app.js
WORKER_ID=3 node src/app.js
```

### 3. 환경 변수 커스터마이징

`.env` 파일에서 수정:
```env
STREAM_KEY=my-custom-stream
GROUP_NAME=my-custom-group
CONSUMER_NAME=my-custom-worker
```

---

## ✅ 체크리스트

- [ ] Docker 설치 확인
- [ ] `docker-compose up -d` 실행
- [ ] `npm install` 실행
- [ ] `node src/app.js` 실행 (Consumer 시작)
- [ ] `node producer.js` 실행 (메시지 발행)
- [ ] Consumer 로그에서 "✅ 저장 및 ACK 완료" 확인
- [ ] MongoDB에서 데이터 조회 확인

---

## 📞 지원

문제 발생 시:
1. Docker 컨테이너 상태 확인: `docker-compose ps`
2. 로그 확인: `docker-compose logs -f`
3. Redis 버전 확인: `docker-compose exec redis redis-cli INFO server`
4. MongoDB 상태 확인: `docker-compose exec mongodb mongosh`


