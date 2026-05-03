const { createRoomServiceClient } = require("../client/roomServiceClient");
const { createSummaryServiceClient } = require("../client/summaryServiceClient");
const { getRecentCommentsForRoom } = require("./commentService");
const { saveSummary } = require("./summaryService");

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_MIN_MESSAGES = 10;
const DEFAULT_MAX_MESSAGES = 100;

function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function createHttpError(status, code, message, details = {}) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.details = details;
    return error;
}

function normalizeUserId(value) {
    return String(value || "").trim();
}

function createManualSummaryService({
    roomServiceClient = createRoomServiceClient(),
    summaryServiceClient = createSummaryServiceClient()
} = {}) {
    const windowMinutes = positiveInt(process.env.SUMMARY_MANUAL_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
    const minMessages = positiveInt(process.env.SUMMARY_MANUAL_MIN_MESSAGES, DEFAULT_MIN_MESSAGES);
    const maxMessages = Math.min(
        positiveInt(process.env.SUMMARY_MANUAL_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
        DEFAULT_MAX_MESSAGES
    );

    async function assertBroadcaster(roomId, requesterUserId) {
        const requester = normalizeUserId(requesterUserId);
        if (!requester) {
            throw createHttpError(401, "REQUESTER_REQUIRED", "requester user id is required");
        }

        const room = await roomServiceClient.getRoom(roomId);
        const broadcasterId = normalizeUserId(room.broadcasterId ?? room.broadcaster_id ?? room.ownerUserId);
        if (!broadcasterId) {
            throw createHttpError(409, "ROOM_BROADCASTER_MISSING", "room broadcaster is not set");
        }
        if (broadcasterId !== requester) {
            throw createHttpError(403, "BROADCASTER_ONLY", "only the room broadcaster can summarize this room");
        }

        return room;
    }

    async function summarizeRoom({ roomId, requesterUserId }) {
        const normalizedRoomId = String(roomId || "").trim();
        if (!normalizedRoomId) {
            throw createHttpError(400, "ROOM_ID_REQUIRED", "roomId is required");
        }

        const room = await assertBroadcaster(normalizedRoomId, requesterUserId);
        const since = new Date(Date.now() - windowMinutes * 60 * 1000);
        const latestComments = await getRecentCommentsForRoom(normalizedRoomId, {
            since,
            limit: maxMessages
        });

        if (latestComments.length < minMessages) {
            throw createHttpError(
                409,
                "INSUFFICIENT_CHAT_MESSAGES",
                `최근 ${windowMinutes}분 내 요약할 채팅이 부족합니다.`,
                {
                    roomId: normalizedRoomId,
                    messageCount: latestComments.length,
                    minMessages,
                    windowMinutes
                }
            );
        }

        const messagesForSummary = [...latestComments].reverse();
        const summaryResult = await summaryServiceClient.callSummarize(messagesForSummary);
        if (!summaryResult.summary) {
            throw createHttpError(502, "EMPTY_SUMMARY", "summary service returned an empty summary");
        }

        const newestComment = latestComments[0];
        const summaryDoc = await saveSummary({
            room_id: normalizedRoomId,
            summary: summaryResult.summary,
            messageCount: summaryResult.messageCount,
            sourceMessageCount: latestComments.length,
            triggerThreshold: minMessages,
            messageIds: messagesForSummary.map((message) => String(message._id)),
            lastCommentId: newestComment?._id ? String(newestComment._id) : undefined,
            latestCommentCreatedAt: newestComment?.createdAt,
            triggerType: "MANUAL",
            requestedBy: requesterUserId,
            windowMinutes
        });

        return {
            roomId: normalizedRoomId,
            roomName: room.name || "",
            summary: summaryDoc.summary,
            messageCount: summaryDoc.messageCount,
            sourceMessageCount: summaryDoc.sourceMessageCount,
            minMessages,
            maxMessages,
            windowMinutes,
            createdAt: summaryDoc.createdAt
        };
    }

    return {
        summarizeRoom
    };
}

module.exports = {
    createManualSummaryService,
    createHttpError
};
