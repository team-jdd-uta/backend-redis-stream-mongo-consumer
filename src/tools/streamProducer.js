require("dotenv").config();
const readline = require("readline");
const { createClient } = require("redis");

const STREAM_KEY = process.env.STREAM_KEY || "comment-stream";
const DEFAULT_BULK_COUNT = Number(process.env.BULK_COUNT || 50000);

const client = createClient({
    url: process.env.REDIS_URL
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

const printHelp = () => {
    console.log("\nEnter a line to publish. Commands:");
    console.log("  /exit  - quit");
    console.log("  /help  - show help\n");
    console.log("Input formats:");
    console.log("  plain text             -> comment only");
    console.log("  JSON                   -> {" +
        "\"user_id\":\"u1\",\"comment\":\"hi\",\"room_id\":42}" +
        "\n");
    console.log("Bulk mode:");
    console.log(`  sends ${DEFAULT_BULK_COUNT} messages per input (BULK_COUNT override)\n`);
};

const normalizeMessage = (line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            const parsed = JSON.parse(trimmed);
            return {
                user_id: String(parsed.user_id || "terminal"),
                comment: String(parsed.comment || ""),
                room_id: String(parsed.room_id || "0"),
                createdAt: "2026-02-11T08:50:12.345Z"

                //new Date().toISOString()
                /*
                *
                * createdAt은 일단 시스템 시간으로 해두었는데, 상황 봐서 클라이언트 시간도 가능할듯
                *
                * */
            };
        } catch (err) {
            console.error("Invalid JSON. Falling back to plain text.");
        }
    }

    return {
        user_id: "terminal",
        comment: trimmed,
        room_id: String(index ?? 0),
        createdAt: new Date().toISOString()
    };
};

const publishLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const start = Date.now();
    let published = 0;

    for (let i = 0; i < DEFAULT_BULK_COUNT; i += 1) {
        const message = normalizeMessage(line, i + 1);
        if (!message) continue;
        await client.xAdd(STREAM_KEY, "*", message);
        published += 1;
    }

    const elapsedMs = Date.now() - start;
    console.log(`Published ${published} messages to ${STREAM_KEY} in ${elapsedMs} ms`);
};

const start = async () => {
    try {
        await client.connect();
        console.log(`Connected. Stream key: ${STREAM_KEY}`);
        printHelp();

        rl.setPrompt("> ");
        rl.prompt();

        rl.on("line", async (line) => {
            const trimmed = line.trim();
            if (trimmed === "/exit") {
                rl.close();
                return;
            }
            if (trimmed === "/help") {
                printHelp();
                rl.prompt();
                return;
            }

            try {
                await publishLine(line);
            } catch (err) {
                console.error("Publish failed:", err.message || err);
            }

            rl.prompt();
        });

        rl.on("close", async () => {
            await client.disconnect();
            console.log("Disconnected.");
            process.exit(0);
        });
    } catch (err) {
        console.error("Startup failed:", err.message || err);
        process.exit(1);
    }
};

start();

/*
*
* 레디스 스트림에 데이터 우르르르 적는 코드
*
*
* */