"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStoreReviews = getStoreReviews;
const node_path_1 = __importDefault(require("node:path"));
const storeReviews_1 = require("../../runtime/storeReviews");
const paths_1 = require("./paths");
let reviews;
function getStoreReviews() {
    return reviews ?? (reviews = new storeReviews_1.StoreReviews(node_path_1.default.resolve(paths_1.BOT_SRC_DIR, "..", "src", "data", "store-reviews.json")));
}
