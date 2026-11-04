"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCheckpointSaves = runCheckpointSaves;
exports.checkpointState = checkpointState;
// Periodic state checkpoint that saves every store.
const utils_1 = require("../../utils");
const metrics_1 = require("./metrics");
const trades_1 = require("../economy/trades");
const giveaways_1 = require("../giveaways/giveaways");
const telemetry_1 = require("./telemetry");
const audit_1 = require("./audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const engagement_1 = require("../xp/engagement");
function runCheckpointSaves(reason, saves) {
    const failures = [];
    for (const [store, save] of Object.entries(saves)) {
        try {
            if (save() === false)
                throw new Error("Store rejected checkpoint");
        }
        catch (error) {
            failures.push(store);
            console.error(`[checkpoint] ${reason}: ${store} save failed:`, error);
        }
    }
    return failures;
}
function checkpointState(reason) {
    const failures = runCheckpointSaves(reason, {
        points: utils_1.savePoints,
        voiceSessions: engagement_1.saveVoiceXpSessions,
        trades: trades_1.saveTradeStore,
        giveaways: giveaways_1.saveGiveawayStore,
        moderation: store_1.saveModerationStore,
        tickets: store_2.saveTicketStore,
        balanceTelemetry: telemetry_1.saveBalanceTelemetry,
        runtimeMetrics: metrics_1.saveRuntimeMetrics
    });
    (0, audit_1.appendAuditEvent)("checkpoint", { reason, failures });
    return failures.length === 0;
}
