const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const Comment = require("../models/Comment");

const getLimit = () => {
    const arg = process.argv[2];
    const parsed = Number(arg || 10000);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
};

const deleteLast = async () => {
    const limit = getLimit();

    try {
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI is missing. Check .env in project root.");
        }
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB 연결 성공");

        const ids = await Comment.find({}, { _id: 1 })
            .sort({ _id: -1 })
            .limit(limit)
            .lean();

        if (ids.length === 0) {
            console.log("삭제할 데이터가 없습니다.");
            return;
        }

        const idList = ids.map((doc) => doc._id);
        const result = await Comment.deleteMany({ _id: { $in: idList } });

        console.log(`🗑️ 삭제 완료: ${result.deletedCount}건 (요청 ${limit}건)`);
    } catch (err) {
        console.error("❌ 삭제 실패:", err.message || err);
    } finally {
        await mongoose.disconnect();
    }
};

deleteLast();

/*
*  node delete-last.js 숫자 (예: node delete-last.js 5000)
*  이런식으로 삭제할 갯수 선택해서 할 수 있음.
*  기본은 10000건
* */
