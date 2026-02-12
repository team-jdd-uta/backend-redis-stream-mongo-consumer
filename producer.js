require("dotenv").config();
const { createClient } = require("redis");

const redisClient = createClient({
    url: process.env.REDIS_URL
});

const publishMessage = async (userData) => {
    try {
        await redisClient.connect();
        console.log("✅ Redis 연결됨");

        const messageId = await redisClient.xAdd(
            process.env.STREAM_KEY,
            "*",
            {
                user_id: userData.user_id,
                comment: userData.comment,
                room_id: userData.room_id.toString(),
                createdAt: new Date().toISOString()
            }
        );

        console.log(`✅ 메시지 발행 성공: ${messageId}`);
        console.log(`📝 데이터:`, userData);

        await redisClient.disconnect();
    } catch (err) {
        console.error("❌ 에러:", err.message);
        process.exit(1);
    }
};

// 테스트 메시지 발행
const testMessages = [
    {
        user_id: "user123",
        comment: "좋아요!",
        room_id: 42
    },
    {
        user_id: "user456",
        comment: "감사합니다!",
        room_id: 42
    },
    {
        user_id: "user789",
        comment: "좋은 내용!",
        room_id: 43
    }
];

// 각 메시지를 500ms 간격으로 발행
(async () => {
    for (let i = 0; i < testMessages.length; i++) {
        console.log(`\n[${i + 1}/${testMessages.length}] 메시지 발행 중...`);
        await publishMessage(testMessages[i]);

        if (i < testMessages.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    console.log("\n✅ 모든 메시지 발행 완료!");
})();

