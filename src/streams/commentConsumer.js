const { redisClient } = require("../config/redis");
const { saveCommentsBatch } = require("../services/commentService");
const { performance } = require("perf_hooks");

const STREAM_KEY = process.env.STREAM_KEY;
const GROUP_NAME = process.env.GROUP_NAME;
const CONSUMER_NAME = process.env.CONSUMER_NAME;
const BATCH_INTERVAL_MS = Number(process.env.BATCH_INTERVAL_MS || 100);
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || 10000);

const createGroup = async () => {
    try {
        // XGROUP CREATE 명령어 실행
        // redis v5에서는 sendCommand 사용 또는 xGroupCreate 메서드 사용
        await redisClient.xGroupCreate(
            STREAM_KEY,
            GROUP_NAME,
            "$",
            {
                MKSTREAM: true
            }
        );
        console.log("✅ Consumer Group 생성 완료");
    } catch (err) {
        const errorMsg = err.message || String(err);


        if (errorMsg.includes("BUSYGROUP") || errorMsg.includes("already exists") || errorMsg.includes("WRONGTYPE")) {
            console.log("ℹConsumer Group 이미 존재 - 계속 진행");
        } else if (errorMsg.includes("unknown command") || errorMsg.includes("XGROUP")) {
            console.error("XGROUP 명령어를 인식하지 못함");
            console.error("   Redis 버전을 확인하세요 (Stream 명령어는 Redis 5.0+ 필요)");
            throw new Error("Redis Stream 명령어 미지원 - Redis 5.0 이상 필요");
        } else {
            console.error("createGroup 에러 상세:", {
                message: errorMsg,
                code: err.code,
                fullError: err
            });
            throw err;
        }
    }
};

const startConsumer = async () => {
    await createGroup();

    console.log("🔄 Consumer 시작: 메시지 대기 중...\n");

    const pending = [];
    let flushing = false;
    let idleLogged = false;

    const flushQueue = async (reason) => {
        if (flushing || pending.length === 0) return;
        flushing = true;

        const batch = pending.splice(0, pending.length);
        const ids = batch.map((item) => item.id);
        const docs = batch.map((item) => item.data);

        try {
            const saveStart = performance.now();
            await saveCommentsBatch(docs);
            const saveMs = performance.now() - saveStart;

            const ackStart = performance.now();
            await redisClient.xAck(
                STREAM_KEY,
                GROUP_NAME,
                ...ids
            );
            const ackMs = performance.now() - ackStart;

            console.log(`✅ 배치 저장 및 ACK 완료: ${ids.length}건 (저장 ${saveMs.toFixed(2)} ms, ACK ${ackMs.toFixed(2)} ms, ${reason})`);
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

    while (true) {
        try {
            const response = await redisClient.xReadGroup(
                GROUP_NAME,
                CONSUMER_NAME,
                { key: STREAM_KEY, id: ">" },
                { COUNT: 100, BLOCK: 5000 }
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
                    pending.push({ id: message.id, data: message.message });

                    if (pending.length >= MAX_BATCH_SIZE) {
                        await flushQueue("max-size");
                    }
                }
            }

        } catch (err) {
            console.error("-------------------Stream 처리 에러:", err.message || err);
            // 에러 발생 시 5초 대기 후 재시도
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};

module.exports = startConsumer;
