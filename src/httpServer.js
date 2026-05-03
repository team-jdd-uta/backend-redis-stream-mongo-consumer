const express = require("express");
const Comment = require("./models/Comment");

const app = express();
const basePath = process.env.HTTP_BASE_PATH || "/api/chat-history";

const asyncHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (err) {
        next(err);
    }
};

const toResponse = (comment) => ({
    id: comment._id?.toString(),
    userId: comment.user_id,
    roomId: comment.room_id,
    comment: comment.comment,
    createdAt: comment.createdAt
});

const queryComments = async (filter) => {
    const comments = await Comment.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .limit(Number(process.env.HTTP_QUERY_LIMIT || 500))
        .lean();
    return comments.map(toResponse);
};

const router = express.Router();

router.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

router.get("/comments/room/:roomId", asyncHandler(async (req, res) => {
    res.json(await queryComments({ room_id: req.params.roomId }));
}));

router.get("/comments/user/:userId", asyncHandler(async (req, res) => {
    res.json(await queryComments({ user_id: req.params.userId }));
}));

router.get("/comments/user/:userId/room/:roomId", asyncHandler(async (req, res) => {
    res.json(await queryComments({
        user_id: req.params.userId,
        room_id: req.params.roomId
    }));
}));

router.get("/comments/room/:roomId/date/:startDate/:endDate", asyncHandler(async (req, res) => {
    res.json(await queryComments({
        room_id: req.params.roomId,
        createdAt: {
            $gte: new Date(req.params.startDate),
            $lte: new Date(req.params.endDate)
        }
    }));
}));

app.use(basePath, router);
app.use(router);

app.use((err, req, res, next) => {
    console.error("❌ HTTP 요청 처리 실패:", err.message || err);
    res.status(500).json({ message: "chat history query failed" });
});

const startHttpServer = () => {
    const port = Number(process.env.PORT || 3010);
    app.listen(port, () => {
        console.log(`✅ Chat history HTTP API listening on ${port}`);
    });
};

module.exports = { startHttpServer };
