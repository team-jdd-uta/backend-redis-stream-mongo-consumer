require("dotenv").config();

const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const { connectRedis } = require("./config/redis");
const { initMariaDb, ensureChatHistorySchema, closeMariaDb } = require("./config/mariadb");
const startConsumer = require("./streams/commentConsumer");
const { queryChatHistory } = require("./services/chatHistoryProjectionService");
const {
    getLatestSummary,
    getSummaryHistory
} = require("./services/summaryService");
const { createManualSummaryService } = require("./services/manualSummaryService");

const app = express();
const PORT = process.env.PORT || 3000;
const manualSummaryService = createManualSummaryService();
let mariaDbReadyPromise = null;
const allowedOrigins = String(
    process.env.CORS_ALLOWED_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,https://front.team9.cloud.skala-ai.com"
)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(express.json());
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin || "*");
        res.header("Vary", "Origin");
    }

    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-User-Id");

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

const sendChatHistory = async (req, res) => {
    try {
        if (!mariaDbReadyPromise) {
            mariaDbReadyPromise = initMariaDb().then(() => ensureChatHistorySchema());
        }
        await mariaDbReadyPromise;

        const ownerUserId = decodeURIComponent(req.params.ownerUserId || "");
        const targetUserId = decodeURIComponent(req.params.targetUserId || "");
        const before = req.query.before || undefined;
        const limit = req.query.limit || undefined;

        if (!ownerUserId || !targetUserId) {
            return res.status(400).json({ message: "ownerUserId and targetUserId are required" });
        }

        const payload = await queryChatHistory({
            ownerUserId,
            targetUserId,
            before,
            limit
        });
        return res.json(payload);
    } catch (error) {
        console.error("[http] chat history query failed:", error);
        return res.status(500).json({
            message: "failed to query chat history",
            error: error.message
        });
    }
};

const sendManualSummary = async (req, res) => {
    try {
        const requesterUserId = String(
            req.header("X-User-Id") ||
            req.body?.requesterUserId ||
            req.body?.userId ||
            ""
        ).trim();

        const result = await manualSummaryService.summarizeRoom({
            roomId: req.params.roomId,
            requesterUserId
        });

        return res.status(201).json(result);
    } catch (error) {
        const status = Number(error.status || 500);
        if (status >= 500) {
            console.error("Manual summary failed:", error);
        }
        return res.status(status).json({
            error: error.code || "SUMMARY_REQUEST_FAILED",
            message: error.message,
            ...(error.details || {})
        });
    }
};

app.get("/api/chat-history/owners/:ownerUserId/users/:targetUserId", sendChatHistory);
app.get("/chat-history/owners/:ownerUserId/users/:targetUserId", sendChatHistory);

app.get("/api/chat-history/summaries/:roomId", sendLatestSummary);
app.get("/api/chat-history/summaries/:roomId/latest", sendLatestSummary);
app.get("/api/chat-history/rooms/:roomId/summary", sendLatestSummary);
app.post("/api/chat-history/rooms/:roomId/summary", sendManualSummary);

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

        const readinessFile = process.env.READINESS_FILE_PATH || path.join(os.tmpdir(), "consumer-ready");
        fs.writeFileSync(readinessFile, "ready\n");
        void startConsumer().catch((err) => {
            console.error("❌ Consumer 실행 실패:", err.message);
            process.exit(1);
        });

        const shutdown = async () => {
            draining.value = true;
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
