const { createClient, createCluster } = require("redis");

const parseClusterNodes = () => (process.env.REDIS_NODES || "")
    .split(",")
    .map((node) => node.trim())
    .filter(Boolean)
    .map((node) => ({
        url: node.startsWith("redis://") || node.startsWith("rediss://")
            ? node
            : `redis://${node}`
    }));

const clusterNodes = parseClusterNodes();
const redisClient = clusterNodes.length > 0
    ? createCluster({
        rootNodes: clusterNodes,
        defaults: {
            socket: {
                reconnectStrategy: (retries) => Math.min(retries * 50, 500)
            }
        }
    })
    : createClient({
        url: process.env.REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => Math.min(retries * 50, 500)
        }
    });

redisClient.on("error", (err) => {
    console.error("❌ Redis 에러:", err.message || err);
});

redisClient.on("ready", () => {
    console.log("✅ Redis 준비됨");
});

const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.log("✅ Redis 연결 성공");

        // Redis 정보 확인
        const info = await redisClient.info("server");
        const versionMatch = info.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
            console.log(`📌 Redis 버전: ${versionMatch[1]}`);
        }
    } catch (err) {
        console.error("❌ Redis 연결 실패:", err.message || err);
        throw err;
    }
};

module.exports = { redisClient, connectRedis };
