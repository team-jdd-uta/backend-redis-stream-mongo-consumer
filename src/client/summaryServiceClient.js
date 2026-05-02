const axios = require("axios");

const SUMMARY_SERVICE_URL = process.env.SUMMARY_SERVICE_URL || "http://localhost:8000";
const SUMMARY_SERVICE_TIMEOUT_MS = Number(process.env.SUMMARY_SERVICE_TIMEOUT_MS || 30000);

const toIsoTimestamp = (value) => {
    if (!value) {
        return new Date().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const normalizeMessage = (msg) => ({
    message: String(msg.message ?? msg.comment ?? "").trim(),
    roomId: String(msg.roomId ?? msg.room_id ?? ""),
    sender: String(msg.sender ?? msg.user_id ?? ""),
    isSuperChat: msg.isSuperChat === true,
    timestamp: toIsoTimestamp(msg.timestamp ?? msg.publishedAt ?? msg.createdAt)
});

function createSummaryServiceClient() {
    const http = axios.create({
        baseURL: SUMMARY_SERVICE_URL,
        timeout: SUMMARY_SERVICE_TIMEOUT_MS
    });

    return {
        async callSummarize(messages) {
            const payload = {
                messages: messages
                    .map(normalizeMessage)
                    .filter((message) => message.message.length > 0)
            };

            if (payload.messages.length === 0) {
                throw new Error("No non-empty messages to summarize");
            }

            try {
                const response = await http.post("/api/messages/analyze", payload);
                const data = response.data || {};

                return {
                    summary: String(data.summary || ""),
                    messageCount: Number(data.messageCount || payload.messages.length)
                };
            } catch (error) {
                const detail = error.response?.data?.detail || error.response?.data?.message;
                const status = error.response?.status;
                const suffix = status ? ` (HTTP ${status}${detail ? `: ${detail}` : ""})` : "";
                throw new Error(`Summary service call failed${suffix}: ${error.message}`);
            }
        }
    };
}

module.exports = {
    createSummaryServiceClient
};
