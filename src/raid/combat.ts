import { getBossCombatProfile, type BossPhase } from "./domain";

export type BossAction = "attack" | "defend" | "heal" | "scan";
export type BossBattleState = {
    turn: number;
    bossHp: number;
    pmcHp: number;
    rage: number;
    armorBreak: number;
    scanRevealed: boolean;
};

export function getBossBattlePhase(bossName: string, hp: number, maxHp: number): BossPhase {
    const phases = getBossCombatProfile(bossName).phases;
    const safeMaxHp = Math.max(1, maxHp);
    const safeHp = Math.max(0, Math.min(safeMaxHp, hp));
    return phases.reduce((active, phase) => safeHp <= safeMaxHp * phase.thresholdPct / 100 && phase.thresholdPct < active.thresholdPct ? phase : active, phases[0]);
}

export function isBossBattleFinished(state: BossBattleState, totalTurns: number): boolean {
    return state.bossHp <= 0 || state.pmcHp <= 0 || state.turn >= totalTurns;
}

export function resolveBossTurn(input: {
    state: BossBattleState;
    action: BossAction;
    totalTurns: number;
    pmcHpMax: number;
    medPatchCount: number;
    random?: () => number;
}): { state: BossBattleState; medPatchesUsed: number; log: string[]; accepted: boolean } {
    const state = { ...input.state };
    if (isBossBattleFinished(state, input.totalTurns)) return { state, medPatchesUsed: 0, log: [], accepted: false };
    if (input.action === "heal" && (input.medPatchCount < 1 || state.pmcHp >= input.pmcHpMax)) {
        return { state, medPatchesUsed: 0, log: [input.medPatchCount < 1 ? "No med patches remaining." : "PMC already at full health."], accepted: false };
    }

    const damageRoll = 30 + Math.floor((input.random || Math.random)() * 36);
    const log: string[] = [];
    let medPatchesUsed = 0;
    if (input.action === "attack") {
        const damage = Math.min(state.bossHp, damageRoll + Math.floor(state.armorBreak * 0.12));
        state.bossHp -= damage;
        state.armorBreak = Math.min(100, state.armorBreak + 18);
        state.rage = Math.min(100, state.rage + 10);
        log.push(`Attack: dealt ${damage} damage. Armor break ${state.armorBreak}%.`);
    } else if (input.action === "defend") {
        const damage = Math.min(state.pmcHp, Math.max(4, Math.floor(damageRoll * 0.28)));
        state.pmcHp -= damage;
        state.rage = Math.max(0, state.rage - 14);
        log.push(`Defend: absorbed pressure, lost ${damage} HP. Rage ${state.rage}%.`);
    } else if (input.action === "heal") {
        const healed = Math.min(70, input.pmcHpMax - state.pmcHp);
        state.pmcHp += healed;
        medPatchesUsed = 1;
        log.push(`Heal: restored ${healed} HP. Used 1 med patch.`);
    } else {
        state.scanRevealed = true;
        state.armorBreak = Math.min(100, state.armorBreak + 8);
        log.push(`Scan: weak points revealed. Armor break ${state.armorBreak}%.`);
    }
    if (state.bossHp > 0 && state.pmcHp > 0 && state.rage >= 70 && input.action !== "defend") {
        const damage = Math.min(state.pmcHp, Math.floor(12 + state.rage * 0.16));
        state.pmcHp -= damage;
        state.rage = Math.min(100, state.rage + 6);
        log.push(`Countercharge: lost ${damage} HP.`);
    }
    state.turn += 1;
    if (state.bossHp <= 0) log.push("Boss neutralized.");
    else if (state.pmcHp <= 0) log.push("PMC incapacitated. Combat ended.");
    else if (state.turn >= input.totalTurns) log.push("Combat window closed. Returning to extraction.");
    return { state, medPatchesUsed, log, accepted: true };
}