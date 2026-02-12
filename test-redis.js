require("dotenv").config();
const { createClient } = require("redis");

const testRedisStream = async () => {
    const client = createClient({
        url: process.env.REDIS_URL
    });

    try {
        console.log("🔗 Redis 연결 중...");
        await client.connect();
        console.log("✅ Redis 연결 성공\n");

        // Redis 버전 확인
        const info = await client.info("server");
        const versionMatch = info.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
            console.log(`📌 Redis 버전: ${versionMatch[1]}\n`);
        }

        const STREAM_KEY = "test-stream";
        const GROUP_NAME = "test-group";

        // 1. 스트림에 메시지 추가
        console.log("1️⃣ 스트림에 메시지 추가...");
        const messageId = await client.xAdd(
            STREAM_KEY,
            "*",
            {
                user_id: "test_user",
                comment: "테스트 메시지",
                room_id: "123"
            }
        );
        console.log(`   ✅ 메시지 ID: ${messageId}\n`);

        // 2. Consumer Group 생성
        console.log("2️⃣ Consumer Group 생성...");
        try {
            await client.xGroupCreate(STREAM_KEY, GROUP_NAME, "$", {
                MKSTREAM: true
            });
            console.log("   ✅ Consumer Group 생성 완료\n");
        } catch (err) {
            const errMsg = err.message || String(err);
            if (errMsg.includes("BUSYGROUP") || errMsg.includes("already exists")) {
                console.log("   ℹ️ Consumer Group 이미 존재\n");
            } else {
                console.error("   ❌ 오류:", errMsg);
                throw err;
            }
        }

        // 3. 메시지 조회
        console.log("3️⃣ xReadGroup으로 메시지 조회...");
        const response = await client.xReadGroup(
            GROUP_NAME,
            "test-consumer",
            { key: STREAM_KEY, id: ">" },
            { COUNT: 10, BLOCK: 1000 }
        );

        if (response) {
            console.log(`   ✅ 메시지 수신: ${response.length}개 스트림`);
            for (const stream of response) {
                console.log(`   📌 스트림: ${stream.name}`);
                for (const message of stream.messages) {
                    console.log(`       - ID: ${message.id}`);
                    console.log(`       - 데이터:`, message.message);
                }
            }
        } else {
            console.log("   ⚠️ 메시지 없음 (또는 타임아웃)");
        }

        console.log("\n✅ 모든 테스트 완료!");

    } catch (err) {
        console.error("\n❌ 테스트 실패:");
        console.error(err.message || err);
    } finally {
        await client.disconnect();
        console.log("\n🔌 Redis 연결 종료");
    }
};

testRedisStream();

