require("dotenv").config();

const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const { connectRedis } = require("./config/redis");
const { initMariaDb, ensureChatHistorySchema, closeMariaDb } = require("./config/mariadb");
const startConsumer = require("./streams/commentConsumer");
const {
    getLatestSummary,
    getSummaryHistory
} = require("./services/summaryService");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

const sendLatestSummary = async (req, res) => {
    try {
        const { roomId } = req.params;
        const summary = await getLatestSummary(roomId);

        if (!summary) {
            return res.status(404).json({
                error: "SUMMARY_NOT_FOUND",
                message: `No summary exists for room_id=${roomId}.`
            });
        }

        return res.json(summary);
    } catch (err) {
        console.error("Summary request failed:", err.message);
        return res.status(500).json({
            error: "SUMMARY_REQUEST_FAILED",
            message: err.message
        });
    }
};

app.get("/api/summaries/:roomId", sendLatestSummary);
app.get("/api/summaries/:roomId/latest", sendLatestSummary);
app.get("/api/rooms/:roomId/summary", sendLatestSummary);

app.get("/api/summaries/:roomId/history", async (req, res) => {
    try {
        const { roomId } = req.params;
        const summaries = await getSummaryHistory(roomId, req.query.limit);
        return res.json({ room_id: String(roomId), summaries });
    } catch (err) {
        console.error("Summary history request failed:", err.message);
        return res.status(500).json({
            error: "SUMMARY_HISTORY_REQUEST_FAILED",
            message: err.message
        });
    }
});

const start = async () => {
    const draining = { value: false };
    const port = Number(process.env.PORT || 3010);
    const httpServer = createChatHistoryServer({ port, drainingRef: draining });

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB connected");

        await connectRedis();

        app.listen(PORT, () => {
            console.log(`HTTP server started: port ${PORT}`);
        });

        console.log("Comment consumer starting");
        console.log(`STREAM_PATTERN: ${process.env.STREAM_PATTERN || process.env.STREAM_KEY || "chat:stream:room:*"}`);
        console.log(`GROUP_NAME: ${process.env.GROUP_NAME || "comment-group"}`);
        console.log(`CONSUMER_NAME: ${process.env.CONSUMER_NAME || "comment-worker-1"}`);

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
        console.error("Application startup failed:", err.message);
        process.exit(1);
    }
};

start();
