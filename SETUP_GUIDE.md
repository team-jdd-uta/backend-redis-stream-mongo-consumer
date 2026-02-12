# 🚀 Redis Stream + MongoDB 테스트 가이드

## 📋 목차
1. [Docker를 이용한 설치 (권장)](#docker를-이용한-설치-권장)
2. [로컬 설치](#로컬-설치)
3. [프로젝트 실행](#프로젝트-실행)
4. [테스트 방법](#테스트-방법)

---

## Docker를 이용한 설치 (권장)

### 사전 요구사항
- Docker 설치 필요
  - [Docker Desktop 다운로드](https://www.docker.com/products/docker-desktop)

### 1단계: docker-compose.yml 생성

프로젝트 루트에 `docker-compose.yml` 파일을 생성하세요:

```yaml
services:
  redis:
    image: redis:latest
    container_name: redis-stream
    ports:
      - "6379:6379"
    command: redis-server --loglevel warning
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  mongodb:
    image: mongo:7
    container_name: mongodb-local
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  mongodb_data:
  redis_data:

networks:
  comment-network:
    driver: bridge
```

**중요**: Redis 버전은 **5.0 이상** 필요합니다 (Stream 명령어 지원).

### 2단계: Docker 컨테이너 시작

```powershell
# 프로젝트 루트 디렉토리에서 실행
docker-compose up -d

# 상태 확인
docker-compose ps
```

### 3단계: 컨테이너 로그 확인

```powershell
# Redis 로그
docker-compose logs redis

# MongoDB 로그
docker-compose logs mongodb

# 모든 로그
docker-compose logs -f
```

---

## 로컬 설치

### Option 1: Windows에 직접 설치

#### Redis 설치
1. [Redis Windows Release](https://github.com/microsoftarchive/redis/releases) 다운로드
2. 설치 및 실행
3. Redis가 `localhost:6379`에서 실행됨

#### MongoDB 설치
1. [MongoDB Community Download](https://www.mongodb.com/try/download/community) 다운로드
2. 설치 시 "MongoDB Community Server" 선택
3. MongoDB가 `localhost:27017`에서 실행됨

---

## 프로젝트 실행

### 1단계: 의존성 설치

```powershell
# 프로젝트 디렉토리에서
npm install
```

### 2단계: 환경 변수 확인 (.env)

```env
MONGO_URI=mongodb://127.0.0.1:27017/commentdb
REDIS_URL=redis://127.0.0.1:6379

# Redis Stream Configuration
STREAM_KEY=comment-stream
GROUP_NAME=comment-group
CONSUMER_NAME=comment-worker-1
```

**MongoDB 인증을 사용하는 경우:**
```env
MONGO_URI=mongodb://admin:password@127.0.0.1:27017/commentdb?authSource=admin
```

### 3단계: Consumer 시작

```powershell
# 터미널 1 - Consumer 실행 (대기 중)
node src/app.js
```

출력 예시:
```
MongoDB 연결 성공
Redis 연결 성공
Consumer Group 생성 완료
```

---

## 테스트 방법

### 방법 1: Redis CLI 사용 (권장)

#### 터미널 2 - Redis CLI 접속

```powershell
# Docker 사용 시
docker-compose exec redis redis-cli

# 로컬 설치 시
redis-cli
```

#### 메시지 발행

```redis
# 단일 메시지 발행
XADD comment-stream * user_id "user123" comment "좋아요!" room_id "42" createdAt "2026-02-11T10:00:00Z"

# 응답 예: "1739254800000-0"

# 여러 메시지 발행
XADD comment-stream * user_id "user456" comment "감사합니다!" room_id "42" createdAt "2026-02-11T10:05:00Z"
XADD comment-stream * user_id "user789" comment "좋은 내용!" room_id "43" createdAt "2026-02-11T10:10:00Z"
```

#### 스트림 상태 확인

```redis
# 스트림의 모든 메시지 확인
XRANGE comment-stream - +

# 스트림 길이 확인
XLEN comment-stream

# Consumer Group 정보 확인
XINFO GROUPS comment-stream

# Consumer 정보 확인
XINFO CONSUMERS comment-stream comment-group

# Pending 메시지 확인
XPENDING comment-stream comment-group
```

---

### 방법 2: Node.js 스크립트로 테스트

#### producer.js 생성

프로젝트 루트에 `producer.js` 파일을 생성하세요:

```javascript
require("dotenv").config();
const { createClient } = require("redis");

const redisClient = createClient({
    url: process.env.REDIS_URL
});

const publishMessage = async () => {
    try {
        await redisClient.connect();
        console.log("Redis 연결됨");

        // 메시지 발행
        const messageId = await redisClient.xAdd(
            process.env.STREAM_KEY,
            "*",
            {
                user_id: "user123",
                comment: "테스트 댓글입니다!",
                room_id: "42",
                createdAt: new Date().toISOString()
            }
        );

        console.log("메시지 발행 성공:", messageId);

        await redisClient.disconnect();
    } catch (err) {
        console.error("에러:", err);
    }
};

publishMessage();
```

#### 실행

```powershell
# 터미널 2에서 (Consumer가 실행 중인 상태)
node producer.js
```

---

### 방법 3: MongoDB에 저장된 데이터 확인

#### 터미널 3 - MongoDB 접속

```powershell
# Docker 사용 시
docker-compose exec mongodb mongosh -u admin -p password

# 로컬 설치 시
mongosh
```

#### 데이터 조회

```mongo
# 데이터베이스 확인
show dbs

# commentdb 선택
use commentdb

# comments 컬렉션 조회
db.comments.find()

# 상세 보기
db.comments.find().pretty()

# 개수 확인
db.comments.countDocuments()
```

---

## 🔄 전체 실행 흐름

```
터미널 1: node src/app.js (Consumer 대기)
         ↓
터미널 2: XADD로 메시지 발행 (또는 node producer.js)
         ↓
Consumer가 메시지 수신
         ↓
MongoDB에 저장
         ↓
xAck로 메시지 확인
         ↓
터미널 3: mongosh에서 db.comments.find() 조회
         ↓
데이터 확인 완료 ✅
```

---

## 🛠️ 트러블슈팅

### 1. "ERR unknown command 'XGROUP'" 에러

```
원인: Redis 버전이 5.0 미만 또는 Stream 명령어를 지원하지 않음
     (Redis Stream은 Redis 5.0부터 지원)

해결책:
- Docker 사용 시: docker-compose down -v 후 다시 시작
- 로컬 설치 시: Redis를 5.0 이상으로 업그레이드
  https://github.com/microsoftarchive/redis/releases
  
# Docker 완전 초기화
docker-compose down -v
docker-compose up -d
```

### 2. "MongoDB 연결 실패" 에러

```
해결책:
- MongoDB가 실행 중인지 확인
- MONGO_URI 확인
- Docker 사용 시: docker-compose ps에서 mongodb가 healthy 상태인지 확인
```

### 3. "Redis 연결 실패" 에러

```
해결책:
- Redis가 실행 중인지 확인
- REDIS_URL 확인
- Docker 사용 시: docker-compose ps에서 redis가 healthy 상태인지 확인
```

### 4. 메시지가 저장되지 않음

```
해결책:
- Consumer가 실행 중인지 확인 (터미널 1)
- Consumer 로그에 에러 메시지가 없는지 확인
- xpending comment-stream comment-group으로 pending 메시지 확인
- 저장 실패 시 Consumer 로그에 "❌ DB 저장 실패" 메시지 표시됨
```

### 5. 컨테이너 재시작

```powershell
# 모든 컨테이너 중지
docker-compose down

# 볼륨 포함 완전 초기화
docker-compose down -v

# 다시 시작
docker-compose up -d
```

---

## 📊 모니터링 팁

### Redis Stream 모니터링
```redis
# 1초마다 상태 갱신 확인
WATCH comment-stream
XLEN comment-stream

# 각 consumer의 처리 상태
XINFO CONSUMERS comment-stream comment-group
```

### MongoDB 모니터링
```mongo
# 실시간 데이터 추가 확인
db.comments.watch()

# 최근 데이터 확인
db.comments.find().sort({_id: -1}).limit(5)
```

---

## ✅ 체크리스트

- [ ] Docker 설치 또는 Redis/MongoDB 로컬 설치 완료
- [ ] docker-compose.yml 생성 (Docker 사용 시)
- [ ] docker-compose up -d 실행 (Docker 사용 시)
- [ ] npm install 완료
- [ ] .env 파일 확인
- [ ] node src/app.js로 Consumer 시작
- [ ] Redis CLI에서 XADD로 메시지 발행
- [ ] Consumer 로그에서 메시지 처리 확인
- [ ] MongoDB에서 저장된 데이터 확인

