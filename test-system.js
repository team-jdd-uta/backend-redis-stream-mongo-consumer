require("dotenv").config();
const mongoose = require("mongoose");
const { redisClient, connectRedis } = require("./src/config/redis");
const Comment = require("./src/models/Comment");

const testSystem = async () => {
    try {
        console.log("🔍 시스템 테스트 시작\n");

        // 1. MongoDB 연결 테스트
        console.log("1️⃣ MongoDB 연결 중...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB 연결 성공\n");

        // 2. Redis 연결 테스트
        console.log("2️⃣ Redis 연결 중...");
        await connectRedis();
        console.log("✅ Redis 연결 성공\n");

        // 3. Comment 저장 테스트
        console.log("3️⃣ Comment 저장 테스트...");
        const testComment = new Comment({
            user_id: "test_user",
            comment: "테스트 댓글입니다!",
            room_id: "123",
            createdAt: new Date()
        });
        await testComment.save();
        console.log("✅ Comment 저장 성공\n");

        // 4. Comment 조회 테스트
        console.log("4️⃣ Comment 조회 테스트...");
        const comments = await Comment.find();
        console.log(`✅ 저장된 Comment 개수: ${comments.length}`);
        console.log("   데이터:", comments[0]);
        console.log();

        // 5. Redis 스트림 메시지 추가 테스트
        console.log("5️⃣ Redis 스트림 메시지 추가...");
        const messageId = await redisClient.xAdd(
            "test-stream",
            "*",
            {
                user_id: "test_user",
                comment: "테스트 메시지",
                room_id: "456"
            }
        );
        console.log(`✅ 메시지 추가 성공: ${messageId}\n`);

        // 6. Redis 스트림 조회 테스트
        console.log("6️⃣ Redis 스트림 조회 테스트...");
        const messages = await redisClient.xRange("test-stream", "-", "+");
        console.log(`✅ 스트림 메시지: ${messages.length}개`);
        if (messages.length > 0) {
            console.log("   첫 번째 메시지:", messages[0]);
        }
        console.log();

        console.log("✅ 모든 테스트 완료!");

    } catch (err) {
        console.error("❌ 테스트 실패:");
        console.error(err.message || err);
    } finally {
        await mongoose.disconnect();
        await redisClient.disconnect();
        console.log("\n🔌 연결 종료");
    }
};

testSystem();

