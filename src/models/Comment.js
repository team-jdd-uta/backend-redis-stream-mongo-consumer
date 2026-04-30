const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
    {
        source_stream_id: { type: String, index: true, unique: true, sparse: true },
        user_id: String,
        sender_display_name: String,
        room_owner_user_id: String,
        room_name: String,
        comment: String,
        room_id: String,
        createdAt: Date,
    }
);

module.exports = mongoose.model("Comment", commentSchema);
