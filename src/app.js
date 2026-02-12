require("dotenv").config();

const mongoose = require("mongoose");
const { connectRedis } = require("./config/redis");
const startConsumer = require("./streams/commentConsumer");

const start = async () => {
    try {
        // MongoDB 연결
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB 연결 성공");

        // Redis 연결
        await connectRedis();

        // Consumer 시작
        console.log("🚀 Comment Consumer 시작 중...");
        console.log(`📌 STREAM_KEY: ${process.env.STREAM_KEY}`);
        console.log(`📌 GROUP_NAME: ${process.env.GROUP_NAME}`);
        console.log(`📌 CONSUMER_NAME: ${process.env.CONSUMER_NAME}`);
        console.log("\n대기 중... (메시지 수신 대기)");

        await startConsumer();
    } catch (err) {
        console.error("❌ 애플리케이션 시작 실패:", err.message);
        process.exit(1);
    }
};

start();
