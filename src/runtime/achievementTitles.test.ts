import assert from "node:assert/strict";
import {
    ACHIEVEMENT_TITLE_BUTTON_ID,
    buildAchievementTitleModal,
    getEquippedAchievementTitle,
    resolveEarnedAchievementTitle
} from "../features/achievementTitles";

const earnedIds = ["xp_100", "voice_1h"];
assert.equal(ACHIEVEMENT_TITLE_BUTTON_ID, "achievement_title_equip");
assert.equal(resolveEarnedAchievementTitle("first signal", earnedIds)?.id, "xp_100");
assert.equal(resolveEarnedAchievementTitle("Apex Operator", earnedIds), null);
assert.equal(getEquippedAchievementTitle("voice_1h", earnedIds)?.title, "First Briefing");
assert.equal(getEquippedAchievementTitle("xp_500", earnedIds), null);
assert.equal(buildAchievementTitleModal("123456789012345678", []), null);

const modal = buildAchievementTitleModal("123456789012345678", earnedIds);
assert.ok(modal);
assert.equal(modal.toJSON().custom_id, "achievement_title_modal:123456789012345678");
assert.equal(modal.toJSON().components[0].components[0].custom_id, "title");
console.log("achievement title tests passed");