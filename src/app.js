require("dotenv").config();

const mongoose = require("mongoose");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { connectRedis } = require("./config/redis");
const { initMariaDb, ensureChatHistorySchema, closeMariaDb } = require("./config/mariadb");
const startConsumer = require("./streams/commentConsumer");
const { createChatHistoryServer } = require("./http/server");

const start = async () => {
    const draining = { value: false };
    const port = Number(process.env.PORT || 3010);
    const httpServer = createChatHistoryServer({ port, drainingRef: draining });

    try {
        // MongoDB 연결
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB 연결 성공");

        // Redis 연결
        await connectRedis();

        // MariaDB 연결 및 projection schema 준비
        await initMariaDb();
        await ensureChatHistorySchema();
        console.log("✅ MariaDB 연결 및 projection schema 준비 완료");

        // Consumer 시작
        console.log("🚀 Comment Consumer 시작 중...");
        console.log(`📌 STREAM_PATTERN: ${process.env.STREAM_PATTERN || process.env.STREAM_KEY || "chat:stream:room:*"}`);
        console.log(`📌 GROUP_NAME: ${process.env.GROUP_NAME}`);
        console.log(`📌 CONSUMER_NAME: ${process.env.CONSUMER_NAME}`);
        console.log("\n대기 중... (메시지 수신 대기)");

        await httpServer.listen();
        console.log(`🌐 Chat history API listening on :${port}`);

        const readinessFile = process.env.READINESS_FILE_PATH || path.join(os.tmpdir(), "consumer-ready");
        fs.writeFileSync(readinessFile, "ready\n");
        void startConsumer().catch((err) => {
            console.error("❌ Consumer 실행 실패:", err.message);
            process.exit(1);
        });

        const shutdown = async () => {
            draining.value = true;
            await httpServer.close().catch(() => undefined);
            await closeMariaDb().catch(() => undefined);
            await mongoose.disconnect().catch(() => undefined);
            process.exit(0);
        };

        process.once("SIGTERM", shutdown);
        process.once("SIGINT", shutdown);
    } catch (err) {
        console.error("❌ 애플리케이션 시작 실패:", err.message);
        await closeMariaDb().catch(() => undefined);
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    }
};

start();
