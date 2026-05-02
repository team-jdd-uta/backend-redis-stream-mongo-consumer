const { performance } = require("perf_hooks");
const { redisClient } = require("../config/redis");
const {
    saveCommentsBatch,
    countCommentsAfterCommentId,
    getLatestCommentsForRoom
} = require("../services/commentService");
const {
    saveSummary,
    getLatestSummary
} = require("../services/summaryService");
const { createSummaryServiceClient } = require("../client/summaryServiceClient");

const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const STREAM_PATTERN = process.env.STREAM_PATTERN || process.env.STREAM_KEY || "chat:stream:room:*";
const GROUP_START_ID = process.env.GROUP_START_ID || "$";
const GROUP_NAME = process.env.GROUP_NAME || "comment-group";
const CONSUMER_NAME = process.env.CONSUMER_NAME || "comment-worker-1";
const BATCH_INTERVAL_MS = positiveInt(process.env.BATCH_INTERVAL_MS, 100);
const MAX_BATCH_SIZE = positiveInt(process.env.MAX_BATCH_SIZE, 10000);
const DISCOVERY_INTERVAL_MS = positiveInt(process.env.DISCOVERY_INTERVAL_MS, 3000);
const READ_COUNT = positiveInt(process.env.READ_COUNT, 100);
const READ_BLOCK_MS = positiveInt(process.env.READ_BLOCK_MS, 5000);
const SUMMARY_BATCH_SIZE = positiveInt(process.env.SUMMARY_BATCH_SIZE, 500);
const SUMMARY_MESSAGE_LIMIT = Math.min(
    positiveInt(process.env.SUMMARY_MESSAGE_LIMIT, SUMMARY_BATCH_SIZE),
    1000
);

const summaryServiceClient = createSummaryServiceClient();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasWildcard = (value) => value.includes("*") || value.includes("?") || value.includes("[");

const knownStreams = new Set();
let activeStreams = [];
let discoveryInProgress = false;

const ensureGroupForStream = async (streamKey) => {
    try {
        await redisClient.xGroupCreate(
            streamKey,
            GROUP_NAME,
            GROUP_START_ID,
            { MKSTREAM: true }
        );
        console.log(`Consumer group ready: ${streamKey}`);
        return true;
    } catch (err) {
        const errorMsg = err.message || String(err);

        if (errorMsg.includes("BUSYGROUP") || errorMsg.includes("already exists")) {
            return true;
        }

        if (errorMsg.includes("WRONGTYPE")) {
            console.warn(`Skipping non-stream key: ${streamKey}`);
            return false;
        }

        if (errorMsg.includes("unknown command") || errorMsg.includes("XGROUP")) {
            throw new Error("Redis Streams require Redis 5.0 or newer");
        }

        console.error("ensureGroupForStream failed:", {
            streamKey,
            message: errorMsg,
            code: err.code
        });
        throw err;
    }
};

const discoverStreamKeys = async () => {
    if (!hasWildcard(STREAM_PATTERN)) {
        return [STREAM_PATTERN];
    }

    const found = [];
    let cursor = "0";

    do {
        const result = await redisClient.scan(cursor, {
            MATCH: STREAM_PATTERN,
            COUNT: 100
        });
        cursor = String(result.cursor);
        found.push(...result.keys);
    } while (cursor !== "0");

    return Array.from(new Set(found)).sort();
};

const refreshStreams = async () => {
    if (discoveryInProgress) {
        return;
    }

    discoveryInProgress = true;

    try {
        const discovered = await discoverStreamKeys();
        const validStreams = [];

        for (const streamKey of discovered) {
            if (!knownStreams.has(streamKey)) {
                const ok = await ensureGroupForStream(streamKey);
                if (ok) {
                    knownStreams.add(streamKey);
                    console.log(`Registered stream: ${streamKey}`);
                }
            }

            if (knownStreams.has(streamKey)) {
                validStreams.push(streamKey);
            }
        }

        activeStreams = validStreams;
    } finally {
        discoveryInProgress = false;
    }
};

const getRoomIdsFromComments = (comments) => {
    return Array.from(
        new Set(
            comments
                .map((comment) => String(comment.room_id || "0"))
                .filter((roomId) => roomId.length > 0)
        )
    );
};

const handleSummarization = async (savedComments) => {
    const roomIds = getRoomIdsFromComments(savedComments);

    for (const roomId of roomIds) {
        try {
            const latestSummary = await getLatestSummary(roomId);
            const lastCommentId = latestSummary?.lastCommentId;
            const newMessageCount = await countCommentsAfterCommentId(roomId, lastCommentId);

            if (newMessageCount < SUMMARY_BATCH_SIZE) {
                console.log(
                    `Summary skipped: room_id=${roomId}, new=${newMessageCount}, threshold=${SUMMARY_BATCH_SIZE}`
                );
                continue;
            }

            const latestComments = await getLatestCommentsForRoom(roomId, SUMMARY_MESSAGE_LIMIT);
            if (latestComments.length === 0) {
                continue;
            }

            const messagesForSummary = [...latestComments].reverse();
            console.log(
                `Summary requested: room_id=${roomId}, source=${newMessageCount}, payload=${messagesForSummary.length}`
            );

            const summaryResult = await summaryServiceClient.callSummarize(messagesForSummary);
            if (!summaryResult.summary) {
                throw new Error("Summary service returned an empty summary");
            }

            const newestComment = latestComments[0];
            await saveSummary({
                room_id: roomId,
                summary: summaryResult.summary,
                messageCount: summaryResult.messageCount,
                sourceMessageCount: newMessageCount,
                triggerThreshold: SUMMARY_BATCH_SIZE,
                messageIds: messagesForSummary.map((message) => String(message._id)),
                lastCommentId: String(newestComment._id),
                latestCommentCreatedAt: newestComment.createdAt
            });

            console.log(`Summary completed: room_id=${roomId}`);
        } catch (err) {
            console.error(`Summary failed: room_id=${roomId}`, err.message || err);
        }
    }
};

const startConsumer = async () => {
    await refreshStreams();

    console.log("Consumer started and waiting for messages");
    console.log(`STREAM_PATTERN: ${STREAM_PATTERN}`);
    console.log(`GROUP_NAME: ${GROUP_NAME}`);
    console.log(`CONSUMER_NAME: ${CONSUMER_NAME}`);
    console.log(`SUMMARY_BATCH_SIZE: ${SUMMARY_BATCH_SIZE}`);
    console.log(`SUMMARY_MESSAGE_LIMIT: ${SUMMARY_MESSAGE_LIMIT}`);

    const pending = [];
    let flushing = false;
    let idleLogged = false;

    const flushQueue = async (reason) => {
        if (flushing || pending.length === 0) {
            return;
        }

        flushing = true;
        const batch = pending.splice(0, pending.length);

        try {
            const saveStart = performance.now();
            const savedComments = await saveCommentsBatch(
                batch.map((item) => ({
                    ...item.data,
                    stream_id: item.id,
                    stream_key: item.stream
                }))
            );
            const saveMs = performance.now() - saveStart;

            const ackStart = performance.now();
            const ackByStream = new Map();

            for (const item of batch) {
                if (!ackByStream.has(item.stream)) {
                    ackByStream.set(item.stream, []);
                }
                ackByStream.get(item.stream).push(item.id);
            }

            for (const [streamKey, ids] of ackByStream.entries()) {
                await redisClient.xAck(streamKey, GROUP_NAME, ...ids);
            }

            const ackMs = performance.now() - ackStart;
            console.log(
                `Batch saved and acked: ${batch.length} (save ${saveMs.toFixed(2)} ms, ACK ${ackMs.toFixed(2)} ms, ${reason})`
            );

            await handleSummarization(savedComments);
        } catch (err) {
            console.error("Batch save failed:", err.message || err);
            pending.unshift(...batch);
        } finally {
            flushing = false;
        }
    };

    setInterval(() => {
        flushQueue("interval");
    }, BATCH_INTERVAL_MS);

    setInterval(() => {
        refreshStreams().catch((err) => {
            console.error("Stream discovery failed:", err.message || err);
        });
    }, DISCOVERY_INTERVAL_MS);

    while (true) {
        try {
            if (activeStreams.length === 0) {
                if (!idleLogged && pending.length === 0 && !flushing) {
                    console.log("Waiting for streams");
                    idleLogged = true;
                }
                await sleep(1000);
                continue;
            }

            const response = await redisClient.xReadGroup(
                GROUP_NAME,
                CONSUMER_NAME,
                activeStreams.map((key) => ({ key, id: ">" })),
                { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS }
            );

            if (!response) {
                if (!idleLogged && pending.length === 0 && !flushing) {
                    console.log("Waiting for messages");
                    idleLogged = true;
                }
                continue;
            }

            idleLogged = false;

            for (const stream of response) {
                for (const message of stream.messages) {
                    pending.push({
                        stream: stream.name,
                        id: message.id,
                        data: message.message,
                        meta: {
                          sourceStreamId: `${stream.name}:${message.id}`,
                        }
                    });

                    if (pending.length >= MAX_BATCH_SIZE) {
                        await flushQueue("max-size");
                    }
                }
            }
        } catch (err) {
            console.error("Stream processing error:", err.message || err);
            await sleep(5000);
        }
    }
};

module.exports = startConsumer;
