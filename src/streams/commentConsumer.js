const { redisClient } = require("../config/redis");
const { saveCommentsBatch } = require("../services/commentService");
const { performance } = require("perf_hooks");

const STREAM_PATTERN = process.env.STREAM_PATTERN || process.env.STREAM_KEY || "chat:stream:room:*";
const GROUP_NAME = process.env.GROUP_NAME;
const CONSUMER_NAME = process.env.CONSUMER_NAME;
const BATCH_INTERVAL_MS = Number(process.env.BATCH_INTERVAL_MS || 100);
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || 10000);
const DISCOVERY_INTERVAL_MS = Number(process.env.DISCOVERY_INTERVAL_MS || 3000);
const READ_COUNT = Number(process.env.READ_COUNT || 100);
const READ_BLOCK_MS = Number(process.env.READ_BLOCK_MS || 5000);

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
            "0",
            { MKSTREAM: true }
        );
        console.log(`✅ Consumer Group 생성 완료: ${streamKey}`);
    } catch (err) {
        const errorMsg = err.message || String(err);

        if (errorMsg.includes("BUSYGROUP") || errorMsg.includes("already exists")) {
            // 이미 생성된 그룹이면 정상 케이스
            return;
        }

        if (errorMsg.includes("WRONGTYPE")) {
            console.warn(`⚠️ Stream 키가 아님, 건너뜀: ${streamKey}`);
            return;
        }

        if (errorMsg.includes("unknown command") || errorMsg.includes("XGROUP")) {
            console.error("XGROUP 명령어를 인식하지 못함");
            console.error("   Redis 버전을 확인하세요 (Stream 명령어는 Redis 5.0+ 필요)");
            throw new Error("Redis Stream 명령어 미지원 - Redis 5.0 이상 필요");
        }

        console.error("ensureGroupForStream 에러 상세:", {
            streamKey,
            message: errorMsg,
            code: err.code,
            fullError: err
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
        cursor = result.cursor;
        found.push(...result.keys);
    } while (cursor !== "0");

    return Array.from(new Set(found)).sort();
};

const refreshStreams = async () => {
    if (discoveryInProgress) return;
    discoveryInProgress = true;

    try {
        const discovered = await discoverStreamKeys();

        for (const streamKey of discovered) {
            if (!knownStreams.has(streamKey)) {
                await ensureGroupForStream(streamKey);
                knownStreams.add(streamKey);
                console.log(`📌 신규 stream 등록: ${streamKey}`);
            }
        }

        activeStreams = discovered;
    } finally {
        discoveryInProgress = false;
    }
};

const startConsumer = async () => {
    await refreshStreams();

    console.log("🔄 Consumer 시작: 메시지 대기 중...\n");
    console.log(`📌 STREAM_PATTERN: ${STREAM_PATTERN}`);
    console.log(`📌 GROUP_NAME: ${GROUP_NAME}`);
    console.log(`📌 CONSUMER_NAME: ${CONSUMER_NAME}`);

    const pending = [];
    let flushing = false;
    let idleLogged = false;

    const flushQueue = async (reason) => {
        if (flushing || pending.length === 0) return;
        flushing = true;

        const batch = pending.splice(0, pending.length);

        try {
            const saveStart = performance.now();
            await saveCommentsBatch(batch.map((item) => item.data));
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
            console.log(`✅ 배치 저장 및 ACK 완료: ${batch.length}건 (저장 ${saveMs.toFixed(2)} ms, ACK ${ackMs.toFixed(2)} ms, ${reason})`);
        } catch (err) {
            console.error("❌ 배치 저장 실패:", err.message || err);
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
            console.error("❌ stream 탐색 실패:", err.message || err);
        });
    }, DISCOVERY_INTERVAL_MS);

    while (true) {
        try {
            if (activeStreams.length === 0) {
                if (!idleLogged && pending.length === 0 && !flushing) {
                    console.log("⏳ 대기 중... (매칭되는 stream 없음)");
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
                    console.log("⏳ 대기 중... (메시지 없음)");
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
                        data: message.message
                    });

                    if (pending.length >= MAX_BATCH_SIZE) {
                        await flushQueue("max-size");
                    }
                }
            }
        } catch (err) {
            console.error("-------------------Stream 처리 에러:", err.message || err);
            await sleep(5000);
        }
    }
};

module.exports = startConsumer;
