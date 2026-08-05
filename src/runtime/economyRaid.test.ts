import assert from "node:assert/strict";
import {
    addTokens,
    depositToBank,
    ensureUser,
    getBankTokens,
    getTokens,
    points,
    savePoints,
    transferWalletTokens,
    withdrawFromBank
} from "../utils";
import { getRaidRewards } from "../game/raid";
import { RAID_MAPS, getBossRotationTable, mapProjection } from "../raid/domain";

function cloneUserState(userId: string) {
    const value = points[userId];
    return value ? JSON.parse(JSON.stringify(value)) : null;
}

function restoreUserState(userId: string, snapshot: unknown): void {
    if (snapshot) {
        points[userId] = snapshot as typeof points[string];
    } else {
        delete points[userId];
    }
}

function runEconomyAndRaidTests(): void {
    const userA = "__test_runtime_user_a__";
    const userB = "__test_runtime_user_b__";
    const snapshotA = cloneUserState(userA);
    const snapshotB = cloneUserState(userB);

    try {
        ensureUser(userA);
        ensureUser(userB);

        points[userA].fnTokens = 0;
        points[userA].bankTokens = 0;
        points[userB].fnTokens = 0;
        points[userB].bankTokens = 0;

        addTokens(userA, 500);
        const afterDeposit = depositToBank(userA, 180);
        assert.equal(afterDeposit.wallet, 320);
        assert.equal(afterDeposit.bank, 180);

        const afterWithdraw = withdrawFromBank(userA, 50);
        assert.equal(afterWithdraw.wallet, 370);
        assert.equal(afterWithdraw.bank, 130);

        const transfer = transferWalletTokens(userA, userB, 120);
        assert.equal(transfer.moved, 120);
        assert.equal(transfer.fromWallet, 250);
        assert.equal(transfer.toWallet, 120);

        assert.equal(getTokens(userA), 250);
        assert.equal(getBankTokens(userA), 130);

        const loot = getRaidRewards("found rare loot");
        const extract = getRaidRewards("extracted alive");
        const fail = getRaidRewards("ran out of ammo");
        assert.equal(loot.tokens, 24);
        assert.equal(extract.tokens, 14);
        assert.equal(fail.tokens, 0);

        for (const mapCfg of Object.values(RAID_MAPS)) {
            const table = getBossRotationTable(mapCfg);
            const totalShare = table.reduce((sum, entry) => sum + entry.sharePct, 0);
            assert.ok(totalShare >= 99.5 && totalShare <= 100.5);

            for (const tension of ["low", "medium", "high"] as const) {
                const projection = mapProjection(mapCfg, tension);
                assert.ok(projection.successPct >= 6 && projection.successPct <= 93);
                assert.ok(projection.tokenMultiplier >= 0.7);
                assert.ok(projection.xpBand[0] >= 1);
                assert.ok(projection.xpBand[1] >= projection.xpBand[0]);
            }
        }
    } finally {
        restoreUserState(userA, snapshotA);
        restoreUserState(userB, snapshotB);
        savePoints();
    }
}

runEconomyAndRaidTests();
console.log("economy + raid tests passed");
