const mongoose = require("mongoose");

const summarySchema = new mongoose.Schema(
    {
        room_id: { type: String, required: true, index: true },
        summary: { type: String, required: true },
        messageCount: { type: Number, required: true },
        sourceMessageCount: { type: Number, default: 0 },
        triggerThreshold: { type: Number, default: 0 },
        triggerType: { type: String, default: "AUTO" },
        requestedBy: String,
        windowMinutes: Number,
        messageIds: [String],
        lastCommentId: { type: String, index: true },
        latestCommentCreatedAt: Date,
        createdAt: { type: Date, default: Date.now, index: true }
    }
);

summarySchema.index({ room_id: 1, createdAt: -1 });

module.exports = mongoose.model("Summary", summarySchema);
