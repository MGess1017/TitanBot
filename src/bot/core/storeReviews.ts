import path from "node:path";
import { StoreReviews } from "../../runtime/storeReviews";
import { BOT_SRC_DIR } from "./paths";

let reviews: StoreReviews | undefined;
export function getStoreReviews(): StoreReviews {
    return reviews ??= new StoreReviews(path.resolve(BOT_SRC_DIR, "..", "src", "data", "store-reviews.json"));
}
