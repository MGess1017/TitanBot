"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
function checkpointState(reason) {
    try {
        (0, utils_1.savePoints)();
        (0, trades_1.saveTradeStore)();
        (0, giveaways_1.saveGiveawayStore)();
        (0, store_1.saveModerationStore)();
        (0, store_2.saveTicketStore)();
        (0, telemetry_1.saveBalanceTelemetry)();
        (0, metrics_1.saveRuntimeMetrics)();
        (0, audit_1.appendAuditEvent)("checkpoint", { reason });
    }
    catch {
        // Best-effort checkpoint only.
    }
}
