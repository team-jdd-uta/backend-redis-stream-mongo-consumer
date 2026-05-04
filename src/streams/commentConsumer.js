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
const { saveChatHistoryBatch } = require("../services/chatHistoryProjectionService");
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
const PENDING_RECOVERY_ENABLED = String(process.env.PENDING_RECOVERY_ENABLED || "true").toLowerCase() === "true";
const PENDING_MIN_IDLE_MS = positiveInt(process.env.PENDING_MIN_IDLE_MS, 60000);
const PENDING_RECOVERY_COUNT = positiveInt(process.env.PENDING_RECOVERY_COUNT, READ_COUNT);
const PENDING_RECOVERY_INTERVAL_MS = positiveInt(process.env.PENDING_RECOVERY_INTERVAL_MS, 30000);
const SUMMARY_BATCH_SIZE = positiveInt(process.env.SUMMARY_BATCH_SIZE, 500);
const SUMMARY_MESSAGE_LIMIT = Math.min(
    positiveInt(process.env.SUMMARY_MESSAGE_LIMIT, SUMMARY_BATCH_SIZE),
    1000
);

const summaryServiceClient = createSummaryServiceClient();
const SUMMARY_AUTO_ENABLED = String(process.env.SUMMARY_AUTO_ENABLED || "false").toLowerCase() === "true";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasWildcard = (value) => value.includes("*") || value.includes("?") || value.includes("[");

const knownStreams = new Set();
let activeStreams = [];
let discoveryInProgress = false;
const queuedSourceIds = new Set();

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

const sourceStreamId = (streamKey, messageId) => `${streamKey}:${messageId}`;

const enqueueStreamMessage = ({ stream, id, data }) => {
    const sourceId = sourceStreamId(stream, id);
    if (queuedSourceIds.has(sourceId)) {
        return null;
    }

    queuedSourceIds.add(sourceId);
    return {
        stream,
        id,
        data: {
            ...data,
            source_stream_id: sourceId,
            stream_id: id,
            stream_key: stream
        }
    };
};

const redisFieldsToObject = (fields) => {
    if (!Array.isArray(fields)) {
        return fields || {};
    }

    const data = {};
    for (let i = 0; i < fields.length; i += 2) {
        data[String(fields[i])] = fields[i + 1];
    }
    return data;
};

const parseAutoClaimMessages = (response) => {
    const messages = Array.isArray(response) ? response[1] : response?.messages;
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages.map((entry) => {
        if (Array.isArray(entry)) {
            return {
                id: entry[0],
                message: redisFieldsToObject(entry[1])
            };
        }
        return {
            id: entry.id,
            message: entry.message || {}
        };
    });
};

const readNewMessages = async () => {
    if (activeStreams.length === 1) {
        return redisClient.xReadGroup(
            GROUP_NAME,
            CONSUMER_NAME,
            [{ key: activeStreams[0], id: ">" }],
            { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS }
        );
    }

    const results = [];

    for (const streamKey of activeStreams) {
        const response = await redisClient.xReadGroup(
            GROUP_NAME,
            CONSUMER_NAME,
            [{ key: streamKey, id: ">" }],
            { COUNT: READ_COUNT, BLOCK: 1 }
        );

        if (response) {
            results.push(...response);
        }
    }

    if (results.length === 0) {
        await sleep(Math.min(READ_BLOCK_MS, 1000));
        return null;
    }

    return results;
};

const handleSummarization = async (savedComments) => {
    if (!SUMMARY_AUTO_ENABLED) {
        return;
    }

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
    console.log(`PENDING_RECOVERY_ENABLED: ${PENDING_RECOVERY_ENABLED}`);
    console.log(`PENDING_MIN_IDLE_MS: ${PENDING_MIN_IDLE_MS}`);
    console.log(`SUMMARY_BATCH_SIZE: ${SUMMARY_BATCH_SIZE}`);
    console.log(`SUMMARY_MESSAGE_LIMIT: ${SUMMARY_MESSAGE_LIMIT}`);
    console.log(`SUMMARY_AUTO_ENABLED: ${SUMMARY_AUTO_ENABLED}`);

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
            const savedComments = await saveCommentsBatch(batch.map((item) => item.data));
            const projectedRows = await saveChatHistoryBatch(batch.map((item) => ({
                data: item.data,
                meta: {
                    sourceStreamId: sourceStreamId(item.stream, item.id)
                }
            })));
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
                `Batch saved and acked: ${batch.length} (mongo ${savedComments.length}, projection ${projectedRows}, save ${saveMs.toFixed(2)} ms, ACK ${ackMs.toFixed(2)} ms, ${reason})`
            );

            await handleSummarization(savedComments);
            for (const item of batch) {
                queuedSourceIds.delete(sourceStreamId(item.stream, item.id));
            }
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

    const recoverPendingMessages = async () => {
        if (!PENDING_RECOVERY_ENABLED || activeStreams.length === 0) {
            return;
        }

        for (const streamKey of activeStreams) {
            try {
                const response = await redisClient.sendCommand([
                    "XAUTOCLAIM",
                    streamKey,
                    GROUP_NAME,
                    CONSUMER_NAME,
                    String(PENDING_MIN_IDLE_MS),
                    "0-0",
                    "COUNT",
                    String(PENDING_RECOVERY_COUNT)
                ]);
                const claimedMessages = parseAutoClaimMessages(response);
                let enqueuedCount = 0;

                for (const message of claimedMessages) {
                    const item = enqueueStreamMessage({
                        stream: streamKey,
                        id: message.id,
                        data: message.message
                    });
                    if (item) {
                        pending.push(item);
                        enqueuedCount += 1;
                    }
                }

                if (enqueuedCount > 0) {
                    console.warn(`Recovered pending stream messages: stream=${streamKey}, count=${enqueuedCount}`);
                    await flushQueue("pending-recovery");
                }
            } catch (err) {
                console.error(`Pending recovery failed: stream=${streamKey}`, err.message || err);
            }
        }
    };

    setInterval(() => {
        recoverPendingMessages().catch((err) => {
            console.error("Pending recovery loop failed:", err.message || err);
        });
    }, PENDING_RECOVERY_INTERVAL_MS);

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

            const response = await readNewMessages();

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
                    const item = enqueueStreamMessage({
                        stream: stream.name,
                        id: message.id,
                        data: message.message
                    });
                    if (!item) {
                        continue;
                    }
                    pending.push(item);

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
