const Summary = require("../models/Summary");

const saveSummary = async (data) => {
    try {
        const summaryDoc = new Summary({
            room_id: String(data.room_id || data.roomId || "0"),
            summary: String(data.summary || ""),
            messageCount: Number(data.messageCount || 0),
            sourceMessageCount: Number(data.sourceMessageCount || 0),
            triggerThreshold: Number(data.triggerThreshold || 0),
            triggerType: String(data.triggerType || "AUTO"),
            requestedBy: data.requestedBy ? String(data.requestedBy) : undefined,
            windowMinutes: data.windowMinutes ? Number(data.windowMinutes) : undefined,
            messageIds: data.messageIds || [],
            lastCommentId: data.lastCommentId ? String(data.lastCommentId) : undefined,
            latestCommentCreatedAt: data.latestCommentCreatedAt
                ? new Date(data.latestCommentCreatedAt)
                : undefined,
            createdAt: new Date()
        });

        await summaryDoc.save();
        console.log(`Summary saved: room_id=${summaryDoc.room_id}, messages=${summaryDoc.messageCount}`);
        return summaryDoc;
    } catch (err) {
        console.error("Summary save failed:", err.message);
        throw err;
    }
};

const getLatestSummary = async (roomId) => {
    try {
        return Summary.findOne({ room_id: String(roomId) })
            .sort({ createdAt: -1 })
            .lean();
    } catch (err) {
        console.error("Summary lookup failed:", err.message);
        throw err;
    }
};

const getSummaryHistory = async (roomId, limit = 10) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);

    try {
        return Summary.find({ room_id: String(roomId) })
            .sort({ createdAt: -1 })
            .limit(safeLimit)
            .lean();
    } catch (err) {
        console.error("Summary history lookup failed:", err.message);
        throw err;
    }
};

module.exports = {
    saveSummary,
    getLatestSummary,
    getSummaryHistory
};
