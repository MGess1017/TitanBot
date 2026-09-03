export type ItemDef = {
    id: string;
    name: string;
    desc: string;
    rarity: string;
    price: number;
    kind?: "resource" | "weapon" | "armor" | "crate" | "token" | "consumable" | "achievement" | "intel" | "key" | "module" | "collectible";
    raidAttack?: number;
    raidDefense?: number;
};

export const COLLECTIBLE_FIXED_VENDOR_PRICE = 100_000_000;

export const BOSS_HEART_DEFS: Record<string, { id: string; name: string; desc: string }> = {
    "The Grave Warden": {
        id: "heart_grave_warden",
        name: "The Grave Warden's Heart",
        desc: "Permanent achievement trophy for defeating The Grave Warden."
    },
    "Sister Vell": {
        id: "heart_sister_vell",
        name: "Sister Vell's Heart",
        desc: "Permanent achievement trophy for defeating Sister Vell."
    },
    "Morrow Fang": {
        id: "heart_morrow_fang",
        name: "Morrow Fang's Heart",
        desc: "Permanent achievement trophy for defeating Morrow Fang."
    },
    "Butcher Prime": {
        id: "heart_butcher_prime",
        name: "Butcher Prime's Heart",
        desc: "Permanent achievement trophy for defeating Butcher Prime."
    },
    "Shardjaw": {
        id: "heart_shardjaw",
        name: "Shardjaw's Heart",
        desc: "Permanent achievement trophy for defeating Shardjaw."
    },
    "Hexline Rook": {
        id: "heart_hexline_rook",
        name: "Hexline Rook's Heart",
        desc: "Permanent achievement trophy for defeating Hexline Rook."
    },
    "Booger King Omega": {
        id: "heart_booger_king_omega",
        name: "Booger King Omega's Heart",
        desc: "Permanent achievement trophy for defeating Booger King Omega."
    },
    "Queen Sumphex": {
        id: "heart_queen_sumphex",
        name: "Queen Sumphex's Heart",
        desc: "Permanent achievement trophy for defeating Queen Sumphex."
    },
    "Warlord Nullhide": {
        id: "heart_warlord_nullhide",
        name: "Nullhide's Heart",
        desc: "Permanent achievement trophy for defeating Warlord Nullhide."
    },
    "Dreadwake Morvane": {
        id: "heart_dreadwake_morvane",
        name: "Dreadwake Morvane's Heart",
        desc: "Permanent achievement trophy for defeating Dreadwake Morvane."
    },
    "Kraghoss the Ashen Standard": {
        id: "heart_kraghoss_ashen_standard",
        name: "Kraghoss' Heart",
        desc: "Permanent achievement trophy for defeating Kraghoss the Ashen Standard."
    },
    "Thalrex Mourntide": {
        id: "heart_thalrex_mourntide",
        name: "Thalrex Mourntide's Heart",
        desc: "Permanent achievement trophy for defeating Thalrex Mourntide."
    }
};

export const BOSS_HEART_IDS = new Set(Object.values(BOSS_HEART_DEFS).map(def => def.id));

export const ITEM_DEFS: Record<string, ItemDef> = {
    scrap: { id: "scrap", name: "Scrap", desc: "Common salvage used for trading and crafting.", rarity: "common", price: 2, kind: "resource" },
    common_crate: { id: "common_crate", name: "Common Crate", desc: "Contains common goods and a chance for cosmetic tokens.", rarity: "common", price: 24, kind: "crate" },
    rare_crate: { id: "rare_crate", name: "Rare Crate", desc: "Better loot with rare materials and token chance.", rarity: "rare", price: 70, kind: "crate" },
    epic_crate: { id: "epic_crate", name: "Epic Crate", desc: "High-tier rewards and legendary token chance.", rarity: "epic", price: 220, kind: "crate" },
    tactical_crate: { id: "tactical_crate", name: "Tactical Crate", desc: "Raid-oriented crate with stronger gear odds.", rarity: "epic", price: 420, kind: "crate" },
    mythic_crate: { id: "mythic_crate", name: "Mythic War Crate", desc: "Endgame crate with elite loot and rare currency pulls.", rarity: "mythic", price: 900, kind: "crate" },
    rare_material_small: { id: "rare_material_small", name: "Rare Material", desc: "Useful for upgrades and crafting.", rarity: "uncommon", price: 18, kind: "resource" },
    rare_material: { id: "rare_material", name: "Rare Material+", desc: "Higher quality crafting material.", rarity: "rare", price: 38, kind: "resource" },
    encrypted_chip: { id: "encrypted_chip", name: "Encrypted Chip", desc: "High-grade intel shard recovered from raid command nodes.", rarity: "rare", price: 95, kind: "resource" },
    relic_fragment: { id: "relic_fragment", name: "Relic Fragment", desc: "Mythic relic shard with high trade value.", rarity: "legendary", price: 320, kind: "resource" },
    cosmetic_token: { id: "cosmetic_token", name: "Cosmetic Token", desc: "Redeem for cosmetic rewards.", rarity: "rare", price: 26, kind: "token" },
    legendary_token: { id: "legendary_token", name: "Legendary Token", desc: "Premium reward token with large value.", rarity: "legendary", price: 150, kind: "token" },
    fn_coin: { id: "fn_coin", name: "FN Coin", desc: "Super rare collectible coin from raids.", rarity: "mythic", price: 2000, kind: "token" },
    rusted_dogtag: { id: "rusted_dogtag", name: "Rusted Dogtag", desc: "Worn battlefield marker with low vendor value.", rarity: "common", price: 24, kind: "resource" },
    weapon_bolts: { id: "weapon_bolts", name: "Weapon Bolts", desc: "Salvaged weapon parts used for rebuild chains.", rarity: "uncommon", price: 62, kind: "resource" },
    servo_motor: { id: "servo_motor", name: "Servo Motor", desc: "Recovered actuator core from raid machinery.", rarity: "rare", price: 190, kind: "resource" },
    nanofiber_roll: { id: "nanofiber_roll", name: "Nanofiber Roll", desc: "Premium weave spool valued by high-end traders.", rarity: "epic", price: 680, kind: "resource" },
    black_ice_lens: { id: "black_ice_lens", name: "Black Ice Lens", desc: "Legend-grade optic fragment from deep-zone caches.", rarity: "legendary", price: 4200, kind: "resource" },
    eclipse_core: { id: "eclipse_core", name: "Eclipse Core", desc: "Ultra-rare raid artifact. Vendor payout is fixed at 1,000,000 FN Token$.", rarity: "mythic", price: 1000000, kind: "resource" },
    sovereign_cipher: { id: "sovereign_cipher", name: "Sovereign Cipher", desc: "Ultra-rare encrypted relic. Vendor payout is fixed at 1,000,000 FN Token$.", rarity: "mythic", price: 1000000, kind: "resource" },
    ghostmatter_relay: { id: "ghostmatter_relay", name: "Ghostmatter Relay", desc: "Ultra-rare anomaly device. Vendor payout is fixed at 1,000,000 FN Token$.", rarity: "mythic", price: 1000000, kind: "resource" },
    collector_obsidian_totem: { id: "collector_obsidian_totem", name: "Obsidian Totem", desc: "Rare collectible relic recovered from collapsed shrines. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_cracked_orrery: { id: "collector_cracked_orrery", name: "Cracked Orrery", desc: "Rare collectible starwork core with ancient route engravings. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_warborn_charm: { id: "collector_warborn_charm", name: "Warborn Charm", desc: "Rare collectible trinket carried by forgotten commanders. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_aether_compass: { id: "collector_aether_compass", name: "Aether Compass", desc: "Rare collectible navigation piece that hums near hazard fronts. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_bloodglass_idol: { id: "collector_bloodglass_idol", name: "Bloodglass Idol", desc: "Rare collectible carved from volatile anomaly glass. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_stormseal_coin: { id: "collector_stormseal_coin", name: "Stormseal Coin", desc: "Rare collectible minted in stormfront bunkers. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_hollow_crown: { id: "collector_hollow_crown", name: "Hollow Crown", desc: "Rare collectible ceremonial crown from the dusk courts. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_drowned_signet: { id: "collector_drowned_signet", name: "Drowned Signet", desc: "Rare collectible signet ring from submerged command vaults. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_marrow_lantern: { id: "collector_marrow_lantern", name: "Marrow Lantern", desc: "Rare collectible lantern rumored to mark hidden supply lanes. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_cipher_tablet: { id: "collector_cipher_tablet", name: "Cipher Tablet", desc: "Rare collectible data slate with unrecovered war directives. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_voidcarved_urn: { id: "collector_voidcarved_urn", name: "Voidcarved Urn", desc: "Rare collectible urn etched with blacksite memorial code. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_riftbone_fang: { id: "collector_riftbone_fang", name: "Riftbone Fang", desc: "Rare collectible fang from apex anomaly fauna. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "legendary", price: 1, kind: "collectible" },
    collector_eternal_halo: { id: "collector_eternal_halo", name: "Eternal Halo", desc: "Extremely rare collectible halo fragment tied to null-sector legends. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "mythic", price: 1, kind: "collectible" },
    collector_omega_reliquary: { id: "collector_omega_reliquary", name: "Omega Reliquary", desc: "Extremely rare collectible reliquary once held by sovereign war priests. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "mythic", price: 1, kind: "collectible" },
    collector_paradox_shard: { id: "collector_paradox_shard", name: "Paradox Shard", desc: "Extremely rare collectible paradox crystal with unstable temporal signatures. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "mythic", price: 1, kind: "collectible" },
    collector_blackstar_diadem: { id: "collector_blackstar_diadem", name: "Blackstar Diadem", desc: "Extremely rare collectible diadem from the deepest collapsed citadels. Vendor payout is fixed at 100,000,000 FN Token$.", rarity: "mythic", price: 1, kind: "collectible" },
    data_shard: { id: "data_shard", name: "Data Shard", desc: "Compact raid intel slice with a reliable vendor floor.", rarity: "uncommon", price: 140, kind: "intel" },
    intel_cache: { id: "intel_cache", name: "Intel Cache", desc: "Recovered command cache with actionable raid information.", rarity: "rare", price: 220, kind: "intel" },
    blacksite_map: { id: "blacksite_map", name: "Blacksite Map", desc: "Elite intel map pointing at hidden cache routes.", rarity: "legendary", price: 520, kind: "intel" },
    tactical_blueprint: { id: "tactical_blueprint", name: "Tactical Blueprint", desc: "Recovered combat schematics with high procurement demand.", rarity: "rare", price: 420, kind: "intel" },
    quantum_logbook: { id: "quantum_logbook", name: "Quantum Logbook", desc: "Anomaly mission records traded by endgame handlers.", rarity: "epic", price: 980, kind: "intel" },
    warbond_chip: { id: "warbond_chip", name: "Warbond Chip", desc: "Encrypted warbond with premium battlefield payout.", rarity: "legendary", price: 2450, kind: "token" },
    reactor_matrix: { id: "reactor_matrix", name: "Reactor Matrix", desc: "Dense power lattice scavenged from destabilized stations.", rarity: "epic", price: 1280, kind: "module" },
    mythic_circuit: { id: "mythic_circuit", name: "Mythic Circuit", desc: "Ultra-grade circuit cluster coveted by elite quartermasters.", rarity: "mythic", price: 6200, kind: "module" },
    prismalloy_ingot: { id: "prismalloy_ingot", name: "Prismalloy Ingot", desc: "Refined alloy ingot used in advanced raid fabrication contracts.", rarity: "epic", price: 1520, kind: "module" },
    hydra_capacitor: { id: "hydra_capacitor", name: "Hydra Capacitor", desc: "Legend-grade capacitor cluster pulled from unstable war machines.", rarity: "legendary", price: 2860, kind: "module" },
    oubliette_pearl: { id: "oubliette_pearl", name: "Oubliette Pearl", desc: "Mythic anomaly pearl with extreme black market appetite.", rarity: "mythic", price: 7600, kind: "resource" },
    spectral_fiber: { id: "spectral_fiber", name: "Spectral Fiber", desc: "Ghost weave fiber that vendors classify as strategic material.", rarity: "legendary", price: 1850, kind: "resource" },
    power_cell: { id: "power_cell", name: "Power Cell", desc: "Portable energy cell used in advanced systems and salvage chains.", rarity: "uncommon", price: 96, kind: "module" },
    signal_array: { id: "signal_array", name: "Signal Array", desc: "High-grade relay module recovered from command tech.", rarity: "rare", price: 310, kind: "module" },
    vault_keycard: { id: "vault_keycard", name: "Vault Keycard", desc: "Restricted access card used for sealed vault logistics.", rarity: "epic", price: 360, kind: "key" },
    boneway_key: { id: "boneway_key", name: "Boneway Key", desc: "Mythic ossuary key that can expose a hidden Catacomb Smuggler extraction.", rarity: "mythic", price: 18500, kind: "key" },
    null_route_cipher: { id: "null_route_cipher", name: "Null Route Cipher", desc: "Mythic blacksite sequence capable of stabilizing a hidden rift extraction.", rarity: "mythic", price: 24000, kind: "intel" },
    sovereign_evac_transponder: { id: "sovereign_evac_transponder", name: "Sovereign Evac Transponder", desc: "Mythic command credential for dormant high-security evacuation lifts.", rarity: "mythic", price: 32000, kind: "key" },
    abyssal_tide_seal: { id: "abyssal_tide_seal", name: "Abyssal Tide Seal", desc: "Mythic drowned sigil that opens sealed routes beneath the Sunken Village.", rarity: "mythic", price: 42000, kind: "key" },
    blueprint_bossbreaker: { id: "blueprint_bossbreaker", name: "Bossbreaker Blueprint", desc: "Rare blueprint for a boss-counter weapon upgrade.", rarity: "legendary", price: 6800, kind: "intel" },
    blueprint_aegis_refit: { id: "blueprint_aegis_refit", name: "Aegis Refit Blueprint", desc: "Rare blueprint for a reinforced armor refit.", rarity: "legendary", price: 7200, kind: "intel" },
    upgrade_core: { id: "upgrade_core", name: "Upgrade Core", desc: "High-grade component used at upgrade benches.", rarity: "epic", price: 950, kind: "module" },
    tactical_overdrive: { id: "tactical_overdrive", name: "Tactical Overdrive", desc: "One-use device that adds a temporary raid loot roll.", rarity: "legendary", price: 2600, kind: "consumable" },
    boss_intel_fragment: { id: "boss_intel_fragment", name: "Boss Intel Fragment", desc: "Reveals progress toward a boss weakness profile.", rarity: "legendary", price: 3100, kind: "intel" },
    hidden_cache_coordinates: { id: "hidden_cache_coordinates", name: "Hidden Cache Coordinates", desc: "Rare coordinates for a map-specific bonus cache.", rarity: "legendary", price: 3800, kind: "intel" },
    seasonal_anomaly_relic: { id: "seasonal_anomaly_relic", name: "Seasonal Anomaly Relic", desc: "Limited seasonal artifact with a unique raid display.", rarity: "mythic", price: 15000, kind: "collectible" },
    boss_trophy_display: { id: "boss_trophy_display", name: "Boss Trophy Display", desc: "A display piece earned for completing a boss collection.", rarity: "legendary", price: 5000, kind: "collectible" },
    acid_spitter: { id: "acid_spitter", name: "Acid Spitter", desc: "Rare Wraith weapon with corrosive pressure and hazard penetration.", rarity: "legendary", price: 7800, kind: "weapon", raidAttack: 0.094 },
    caustic_reaper: { id: "caustic_reaper", name: "Caustic Reaper", desc: "Rare acid-edged weapon that rewards high-tension clears.", rarity: "legendary", price: 8600, kind: "weapon", raidAttack: 0.098 },
    hellhound_carbine: { id: "hellhound_carbine", name: "Hellhound Carbine", desc: "DogMeat's rapid-fire carbine with close-range pursuit power.", rarity: "legendary", price: 7400, kind: "weapon", raidAttack: 0.091 },
    bloodfang_blade: { id: "bloodfang_blade", name: "Bloodfang Blade", desc: "A brutal rare blade that converts boss pressure into XP.", rarity: "legendary", price: 8200, kind: "weapon", raidAttack: 0.101 },
    doom_scepter: { id: "doom_scepter", name: "Doom Scepter", desc: "Queen Of Doom relic weapon with high reward conversion.", rarity: "mythic", price: 12500, kind: "weapon", raidAttack: 0.112 },
    widow_arc: { id: "widow_arc", name: "Widow Arc", desc: "Crown-forged arc weapon with precision and token pressure.", rarity: "legendary", price: 9800, kind: "weapon", raidAttack: 0.104 },
    chaos_staff: { id: "chaos_staff", name: "Chaos Staff", desc: "Extremely rare Wizard Of Chaos weapon. Paired with Apocalypse Aegis, it bends boss phases and multiplies mastery gains.", rarity: "mythic", price: 50000, kind: "weapon", raidAttack: 0.16 },
    reality_breaker: { id: "reality_breaker", name: "Reality Breaker", desc: "Wizard-forged mythic weapon with unstable endgame output.", rarity: "mythic", price: 42000, kind: "weapon", raidAttack: 0.132 },
    eclipse_glaive: { id: "eclipse_glaive", name: "Eclipse Glaive", desc: "Rare rotating-edge weapon found in sealed apex caches.", rarity: "mythic", price: 18000, kind: "weapon", raidAttack: 0.118 },
    demoncore_lance: { id: "demoncore_lance", name: "Demoncore Lance", desc: "Rare lance with strong alternate-form boss pressure.", rarity: "mythic", price: 22000, kind: "weapon", raidAttack: 0.125 },
    acidbound_shell: { id: "acidbound_shell", name: "Acidbound Shell", desc: "Rare armor that resists corrosive hazards and boss attrition.", rarity: "legendary", price: 7800, kind: "armor", raidDefense: 0.092 },
    venomward_suit: { id: "venomward_suit", name: "Venomward Suit", desc: "Rare protective suit with poison and acid route stability.", rarity: "legendary", price: 8600, kind: "armor", raidDefense: 0.097 },
    hellhide_harness: { id: "hellhide_harness", name: "Hellhide Harness", desc: "DogMeat armor with pursuit resilience and close-range mitigation.", rarity: "legendary", price: 7400, kind: "armor", raidDefense: 0.089 },
    doomplate_carapace: { id: "doomplate_carapace", name: "Doomplate Carapace", desc: "Queen Of Doom armor with heavy boss survival value.", rarity: "mythic", price: 13500, kind: "armor", raidDefense: 0.116 },
    crownfall_raiment: { id: "crownfall_raiment", name: "Crownfall Raiment", desc: "Rare royal armor that improves high-risk extraction odds.", rarity: "legendary", price: 10200, kind: "armor", raidDefense: 0.105 },
    chaos_mantle: { id: "chaos_mantle", name: "Chaos Mantle", desc: "Extremely rare Wizard Of Chaos armor. Paired with Chaos Staff for an apex boss-counter set.", rarity: "mythic", price: 52000, kind: "armor", raidDefense: 0.18 },
    apocalypse_aegis: { id: "apocalypse_aegis", name: "Apocalypse Aegis", desc: "Wizard-forged mythic armor with exceptional final-phase resilience.", rarity: "mythic", price: 46000, kind: "armor", raidDefense: 0.145 },
    eclipse_bulwark: { id: "eclipse_bulwark", name: "Eclipse Bulwark", desc: "Rare sealed armor for apex cache runs.", rarity: "mythic", price: 19000, kind: "armor", raidDefense: 0.126 },
    demoncore_mail: { id: "demoncore_mail", name: "Demoncore Mail", desc: "Rare mail that steadies alternate-form encounters.", rarity: "mythic", price: 23000, kind: "armor", raidDefense: 0.134 },
    wraithveil_hood: { id: "wraithveil_hood", name: "Wraithveil Hood", desc: "Rare stealth armor with exceptional low-visibility control.", rarity: "legendary", price: 9000, kind: "armor", raidDefense: 0.101 },
    med_patch: { id: "med_patch", name: "Med Patch", desc: "Improvised field patch used for emergency field repairs.", rarity: "common", price: 42, kind: "consumable" },
    heart_grave_warden: { id: "heart_grave_warden", name: "The Grave Warden's Heart", desc: "Permanent achievement trophy for defeating The Grave Warden.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_sister_vell: { id: "heart_sister_vell", name: "Sister Vell's Heart", desc: "Permanent achievement trophy for defeating Sister Vell.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_morrow_fang: { id: "heart_morrow_fang", name: "Morrow Fang's Heart", desc: "Permanent achievement trophy for defeating Morrow Fang.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_butcher_prime: { id: "heart_butcher_prime", name: "Butcher Prime's Heart", desc: "Permanent achievement trophy for defeating Butcher Prime.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_shardjaw: { id: "heart_shardjaw", name: "Shardjaw's Heart", desc: "Permanent achievement trophy for defeating Shardjaw.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_hexline_rook: { id: "heart_hexline_rook", name: "Hexline Rook's Heart", desc: "Permanent achievement trophy for defeating Hexline Rook.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_booger_king_omega: { id: "heart_booger_king_omega", name: "Booger King Omega's Heart", desc: "Permanent achievement trophy for defeating Booger King Omega.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_queen_sumphex: { id: "heart_queen_sumphex", name: "Queen Sumphex's Heart", desc: "Permanent achievement trophy for defeating Queen Sumphex.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_warlord_nullhide: { id: "heart_warlord_nullhide", name: "Nullhide's Heart", desc: "Permanent achievement trophy for defeating Warlord Nullhide.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_dreadwake_morvane: { id: "heart_dreadwake_morvane", name: "Dreadwake Morvane's Heart", desc: "Permanent achievement trophy for defeating Dreadwake Morvane.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_kraghoss_ashen_standard: { id: "heart_kraghoss_ashen_standard", name: "Kraghoss' Heart", desc: "Permanent achievement trophy for defeating Kraghoss the Ashen Standard.", rarity: "mythic", price: 0, kind: "achievement" },
    heart_thalrex_mourntide: { id: "heart_thalrex_mourntide", name: "Thalrex Mourntide's Heart", desc: "Permanent achievement trophy for defeating Thalrex Mourntide.", rarity: "mythic", price: 0, kind: "achievement" },
    field_ration: { id: "field_ration", name: "Field Ration", desc: "Use to gain immediate FN Token$ while in recovery.", rarity: "common", price: 30, kind: "consumable" },
    combat_stim: { id: "combat_stim", name: "Combat Stim", desc: "Use to gain immediate raid XP and engagement XP.", rarity: "rare", price: 120, kind: "consumable" },
    scav_beacon: { id: "scav_beacon", name: "Scav Beacon", desc: "Use to call in a random supply cache.", rarity: "epic", price: 260, kind: "consumable" },
    repair_kit: { id: "repair_kit", name: "Repair Kit", desc: "Use to convert scrap into improved crafting resources.", rarity: "uncommon", price: 75, kind: "consumable" },
    rust_blade: { id: "rust_blade", name: "Rust Blade", desc: "Basic raid weapon with slight attack bonus.", rarity: "common", price: 55, kind: "weapon", raidAttack: 0.01 },
    combat_knife: { id: "combat_knife", name: "Combat Knife", desc: "Close-range weapon for better strike chance.", rarity: "uncommon", price: 120, kind: "weapon", raidAttack: 0.015 },
    pulse_rifle: { id: "pulse_rifle", name: "Pulse Rifle", desc: "Reliable ranged weapon for raids.", rarity: "rare", price: 380, kind: "weapon", raidAttack: 0.03 },
    ion_cannon: { id: "ion_cannon", name: "Ion Cannon", desc: "High-energy weapon with major raid impact.", rarity: "epic", price: 1200, kind: "weapon", raidAttack: 0.055 },
    mythic_hammer: { id: "mythic_hammer", name: "Mythic Hammer", desc: "Legendary raid weapon.", rarity: "legendary", price: 2600, kind: "weapon", raidAttack: 0.08 },
    scav_smg: { id: "scav_smg", name: "Scav SMG", desc: "Fast spray weapon effective in close urban raids.", rarity: "uncommon", price: 220, kind: "weapon", raidAttack: 0.02 },
    marksman_dmr: { id: "marksman_dmr", name: "Marksman DMR", desc: "Precision rifle with improved fog/night performance.", rarity: "rare", price: 460, kind: "weapon", raidAttack: 0.034 },
    thermal_lance: { id: "thermal_lance", name: "Thermal Lance", desc: "Heat-adapted weapon that cuts through storm conditions.", rarity: "epic", price: 1360, kind: "weapon", raidAttack: 0.06 },
    plasma_carbine: { id: "plasma_carbine", name: "Plasma Carbine", desc: "Balanced high-energy rifle with strong consistency.", rarity: "epic", price: 1480, kind: "weapon", raidAttack: 0.062 },
    rail_sniper: { id: "rail_sniper", name: "Rail Sniper", desc: "Extreme long-range weapon with high-condition variance.", rarity: "legendary", price: 2850, kind: "weapon", raidAttack: 0.085 },
    reactor_blade: { id: "reactor_blade", name: "Reactor Blade", desc: "Close-quarters legendary blade with surge bursts.", rarity: "legendary", price: 3150, kind: "weapon", raidAttack: 0.09 },
    scrap_shotgun: { id: "scrap_shotgun", name: "Scrap Shotgun", desc: "Jury-rigged shotgun with reliable close-range stopping power.", rarity: "common", price: 75, kind: "weapon", raidAttack: 0.016 },
    breach_pistol: { id: "breach_pistol", name: "Breach Pistol", desc: "Compact sidearm built for door fights and fast entries.", rarity: "uncommon", price: 145, kind: "weapon", raidAttack: 0.021 },
    hush_repeater: { id: "hush_repeater", name: "Hush Repeater", desc: "Quiet repeater that stays stable in low-visibility raids.", rarity: "uncommon", price: 210, kind: "weapon", raidAttack: 0.024 },
    arc_rifle: { id: "arc_rifle", name: "Arc Rifle", desc: "Charged rifle tuned for medium-range suppression.", rarity: "rare", price: 410, kind: "weapon", raidAttack: 0.032 },
    volt_smg: { id: "volt_smg", name: "Volt SMG", desc: "High-cycle SMG that shines in tight routes.", rarity: "rare", price: 470, kind: "weapon", raidAttack: 0.036 },
    dune_cutter: { id: "dune_cutter", name: "Dune Cutter", desc: "Heat-treated carbine built for long rotations in hostile terrain.", rarity: "rare", price: 520, kind: "weapon", raidAttack: 0.039 },
    widowmaker_dmr: { id: "widowmaker_dmr", name: "Widowmaker DMR", desc: "High-stability marksman platform for precision extractions.", rarity: "rare", price: 610, kind: "weapon", raidAttack: 0.043 },
    magma_caster: { id: "magma_caster", name: "Magma Caster", desc: "Molten-core projector that excels under thermal strain.", rarity: "epic", price: 990, kind: "weapon", raidAttack: 0.048 },
    echo_lancer: { id: "echo_lancer", name: "Echo Lancer", desc: "Signal-guided rifle that rewards disciplined cadence.", rarity: "epic", price: 1120, kind: "weapon", raidAttack: 0.051 },
    grav_pike: { id: "grav_pike", name: "Grav Pike", desc: "Heavy striker with bonus raid pressure on decisive pushes.", rarity: "epic", price: 1240, kind: "weapon", raidAttack: 0.054 },
    venom_flechette: { id: "venom_flechette", name: "Venom Flechette", desc: "Flechette launcher built for armor-shredding bursts.", rarity: "epic", price: 1380, kind: "weapon", raidAttack: 0.057 },
    rift_carbine: { id: "rift_carbine", name: "Rift Carbine", desc: "Distortion-tuned rifle with high-end consistency.", rarity: "epic", price: 1510, kind: "weapon", raidAttack: 0.06 },
    obsidian_repeater: { id: "obsidian_repeater", name: "Obsidian Repeater", desc: "Dark-alloy repeater with elite handling and payout upside.", rarity: "legendary", price: 1780, kind: "weapon", raidAttack: 0.064 },
    siege_cannon: { id: "siege_cannon", name: "Siege Cannon", desc: "Bulky launcher that thrives in entrenched raids.", rarity: "legendary", price: 2100, kind: "weapon", raidAttack: 0.068 },
    frostfang_rifle: { id: "frostfang_rifle", name: "Frostfang Rifle", desc: "Cryo-lined rifle that keeps accuracy in unstable weather.", rarity: "legendary", price: 2380, kind: "weapon", raidAttack: 0.072 },
    stormpiercer: { id: "stormpiercer", name: "Stormpiercer", desc: "Tempest-graded rifle with high-value storm penetration.", rarity: "legendary", price: 2640, kind: "weapon", raidAttack: 0.076 },
    aurora_smg: { id: "aurora_smg", name: "Aurora SMG", desc: "Phase-lit SMG tuned for burst control in fast lane fights.", rarity: "rare", price: 820, kind: "weapon", raidAttack: 0.041 },
    basilisk_dmr: { id: "basilisk_dmr", name: "Basilisk DMR", desc: "Heavy DMR with hardened recoil profile for difficult extracts.", rarity: "epic", price: 1700, kind: "weapon", raidAttack: 0.058 },
    overclock_minigun: { id: "overclock_minigun", name: "Overclock Minigun", desc: "Legendary rotary cannon that dominates anchored engagements.", rarity: "legendary", price: 3520, kind: "weapon", raidAttack: 0.083 },
    nebula_glaive: { id: "nebula_glaive", name: "Nebula Glaive", desc: "Mythic grav-edge polearm built for elite breach finishes.", rarity: "mythic", price: 4380, kind: "weapon", raidAttack: 0.095 },
    nullburst_launcher: { id: "nullburst_launcher", name: "Nullburst Launcher", desc: "Mythic launcher with volatile anomaly throughput.", rarity: "mythic", price: 3200, kind: "weapon", raidAttack: 0.081 },
    phantom_scythe: { id: "phantom_scythe", name: "Phantom Scythe", desc: "Spectral edge weapon that amplifies stealth clears.", rarity: "mythic", price: 3480, kind: "weapon", raidAttack: 0.086 },
    sunflare_accelerator: { id: "sunflare_accelerator", name: "Sunflare Accelerator", desc: "Solar-bloom accelerator with premium extraction impact.", rarity: "mythic", price: 3820, kind: "weapon", raidAttack: 0.091 },
    starforged_reaper: { id: "starforged_reaper", name: "Starforged Reaper", desc: "Ultra-rare mythic weapon with apex raid potential.", rarity: "mythic", price: 4250, kind: "weapon", raidAttack: 0.097 },
    enhanced_pulse_rifle: { id: "enhanced_pulse_rifle", name: "Enhanced Pulse Rifle", desc: "Up-tuned pulse rifle with reinforced capacitor rails.", rarity: "epic", price: 1980, kind: "weapon", raidAttack: 0.045 },
    enhanced_marksman_dmr: { id: "enhanced_marksman_dmr", name: "Enhanced Marksman DMR", desc: "Precision-enhanced DMR with superior extraction lethality.", rarity: "epic", price: 2340, kind: "weapon", raidAttack: 0.052 },
    enhanced_thermal_lance: { id: "enhanced_thermal_lance", name: "Enhanced Thermal Lance", desc: "Advanced thermal lance with stabilized heat channels.", rarity: "legendary", price: 2980, kind: "weapon", raidAttack: 0.074 },
    enhanced_plasma_carbine: { id: "enhanced_plasma_carbine", name: "Enhanced Plasma Carbine", desc: "Elite plasma carbine tuned for clean conversion pressure.", rarity: "legendary", price: 3140, kind: "weapon", raidAttack: 0.078 },
    enhanced_rail_sniper: { id: "enhanced_rail_sniper", name: "Enhanced Rail Sniper", desc: "High-caliber enhanced sniper with amplified terminal force.", rarity: "mythic", price: 4080, kind: "weapon", raidAttack: 0.102 },
    enhanced_reactor_blade: { id: "enhanced_reactor_blade", name: "Enhanced Reactor Blade", desc: "Refined reactor edge with superior close-quarter finish rate.", rarity: "mythic", price: 4360, kind: "weapon", raidAttack: 0.108 },
    enhanced_nullburst_launcher: { id: "enhanced_nullburst_launcher", name: "Enhanced Nullburst Launcher", desc: "Apex-enhanced anomaly launcher with extreme breach output.", rarity: "mythic", price: 4720, kind: "weapon", raidAttack: 0.113 },
    enhanced_starforged_reaper: { id: "enhanced_starforged_reaper", name: "Enhanced Starforged Reaper", desc: "Ultra-enhanced apex weapon with endgame raid dominance.", rarity: "mythic", price: 5400, kind: "weapon", raidAttack: 0.12 },
    field_vest: { id: "field_vest", name: "Field Vest", desc: "Basic armor reducing raid losses.", rarity: "common", price: 65, kind: "armor", raidDefense: 0.01 },
    tactical_armor: { id: "tactical_armor", name: "Tactical Armor", desc: "Balanced armor with durability.", rarity: "uncommon", price: 180, kind: "armor", raidDefense: 0.018 },
    guardian_plate: { id: "guardian_plate", name: "Guardian Plate", desc: "Advanced armor reducing failure penalty.", rarity: "rare", price: 520, kind: "armor", raidDefense: 0.03 },
    void_shield: { id: "void_shield", name: "Void Shield", desc: "Epic-tier defense for raids.", rarity: "epic", price: 1500, kind: "armor", raidDefense: 0.05 },
    aegis_exosuit: { id: "aegis_exosuit", name: "Aegis Exosuit", desc: "Legendary armor for maximum survivability.", rarity: "legendary", price: 3000, kind: "armor", raidDefense: 0.075 },
    scout_weave: { id: "scout_weave", name: "Scout Weave", desc: "Light armor optimized for rapid repositioning.", rarity: "uncommon", price: 230, kind: "armor", raidDefense: 0.015 },
    storm_shell: { id: "storm_shell", name: "Storm Shell", desc: "Weather-sealed armor tuned for storm raids.", rarity: "rare", price: 590, kind: "armor", raidDefense: 0.032 },
    shadow_cloak: { id: "shadow_cloak", name: "Shadow Cloak", desc: "Stealth armor favored for night/fog operations.", rarity: "rare", price: 640, kind: "armor", raidDefense: 0.035 },
    juggernaut_frame: { id: "juggernaut_frame", name: "Juggernaut Frame", desc: "Heavy frame with large mitigation and mobility tradeoffs.", rarity: "epic", price: 1780, kind: "armor", raidDefense: 0.058 },
    adaptive_mesh: { id: "adaptive_mesh", name: "Adaptive Mesh", desc: "Smart armor adapting to varied raid triggers.", rarity: "epic", price: 1660, kind: "armor", raidDefense: 0.054 },
    titan_carapace: { id: "titan_carapace", name: "Titan Carapace", desc: "Top-tier armor with strong mitigation under pressure.", rarity: "legendary", price: 3300, kind: "armor", raidDefense: 0.082 },
    patchwork_rig: { id: "patchwork_rig", name: "Patchwork Rig", desc: "Salvaged rig with modest loss mitigation.", rarity: "common", price: 80, kind: "armor", raidDefense: 0.012 },
    breacher_webbing: { id: "breacher_webbing", name: "Breacher Webbing", desc: "Light breach kit for aggressive route tempo.", rarity: "uncommon", price: 150, kind: "armor", raidDefense: 0.016 },
    fogrunner_wrap: { id: "fogrunner_wrap", name: "Fogrunner Wrap", desc: "Low-visibility cloak built for ambush extracts.", rarity: "uncommon", price: 220, kind: "armor", raidDefense: 0.019 },
    arcskin_vest: { id: "arcskin_vest", name: "Arcskin Vest", desc: "Insulated vest with improved hazard tolerance.", rarity: "rare", price: 360, kind: "armor", raidDefense: 0.023 },
    warden_harness: { id: "warden_harness", name: "Warden Harness", desc: "Tactical harness that balances defense and route speed.", rarity: "rare", price: 430, kind: "armor", raidDefense: 0.026 },
    emberguard_mail: { id: "emberguard_mail", name: "Emberguard Mail", desc: "Thermal mail that resists punishing heat zones.", rarity: "rare", price: 510, kind: "armor", raidDefense: 0.029 },
    coastwatch_shell: { id: "coastwatch_shell", name: "Coastwatch Shell", desc: "Sealed shell with stable storm performance.", rarity: "rare", price: 580, kind: "armor", raidDefense: 0.032 },
    nomad_carbon: { id: "nomad_carbon", name: "Nomad Carbon", desc: "Route-ready carbon laminate with strong all-round mitigation.", rarity: "rare", price: 690, kind: "armor", raidDefense: 0.033 },
    nightglass_cloak: { id: "nightglass_cloak", name: "Nightglass Cloak", desc: "High-end stealth weave for dark or fogged routes.", rarity: "rare", price: 650, kind: "armor", raidDefense: 0.036 },
    bulwark_plating: { id: "bulwark_plating", name: "Bulwark Plating", desc: "Dense plates tuned for prolonged firefights.", rarity: "epic", price: 980, kind: "armor", raidDefense: 0.041 },
    shockframe_suit: { id: "shockframe_suit", name: "Shockframe Suit", desc: "Powered suit that smooths hazard-heavy operations.", rarity: "epic", price: 1120, kind: "armor", raidDefense: 0.045 },
    gravebark_mesh: { id: "gravebark_mesh", name: "Gravebark Mesh", desc: "Adaptive mesh with strong pressure control in dark terrain.", rarity: "epic", price: 1240, kind: "armor", raidDefense: 0.048 },
    riftguard_coat: { id: "riftguard_coat", name: "Riftguard Coat", desc: "Anomaly-lined coat with steady all-round mitigation.", rarity: "epic", price: 1380, kind: "armor", raidDefense: 0.052 },
    bastion_weave: { id: "bastion_weave", name: "Bastion Weave", desc: "Fortified weave plating tuned for high-pressure rotation lanes.", rarity: "epic", price: 1790, kind: "armor", raidDefense: 0.056 },
    siegebreaker_plate: { id: "siegebreaker_plate", name: "Siegebreaker Plate", desc: "Heavy breach armor tuned for costly map pressure.", rarity: "legendary", price: 1680, kind: "armor", raidDefense: 0.057 },
    hollowbastion: { id: "hollowbastion", name: "Hollow Bastion", desc: "Void-lined bastion shell with elite staying power.", rarity: "legendary", price: 1920, kind: "armor", raidDefense: 0.061 },
    stormforged_aegis: { id: "stormforged_aegis", name: "Stormforged Aegis", desc: "High-capacity aegis armor for severe weather raids.", rarity: "legendary", price: 2210, kind: "armor", raidDefense: 0.066 },
    cryptsteel_exoshell: { id: "cryptsteel_exoshell", name: "Cryptsteel Exoshell", desc: "Ancient alloy shell with elite stealth endurance.", rarity: "legendary", price: 2520, kind: "armor", raidDefense: 0.071 },
    leviathan_shell: { id: "leviathan_shell", name: "Leviathan Shell", desc: "Legendary deep-zone shell that stabilizes severe encounters.", rarity: "legendary", price: 3410, kind: "armor", raidDefense: 0.079 },
    tidelock_panoply: { id: "tidelock_panoply", name: "Tidelock Panoply", desc: "Flood-sealed mythic armor tuned for collapse zones.", rarity: "mythic", price: 3060, kind: "armor", raidDefense: 0.077 },
    dreadnought_cuirass: { id: "dreadnought_cuirass", name: "Dreadnought Cuirass", desc: "Mythic cuirass that trades speed for superior stability.", rarity: "mythic", price: 3380, kind: "armor", raidDefense: 0.082 },
    voidscale_regalia: { id: "voidscale_regalia", name: "Voidscale Regalia", desc: "Ultra-rare regalia favored for stealth and anomaly dives.", rarity: "mythic", price: 3720, kind: "armor", raidDefense: 0.087 },
    eclipse_ward: { id: "eclipse_ward", name: "Eclipse Ward", desc: "Mythic ward frame offering apex stability in hostile sectors.", rarity: "mythic", price: 4620, kind: "armor", raidDefense: 0.091 },
    sovereign_bastion: { id: "sovereign_bastion", name: "Sovereign Bastion", desc: "Apex mythic armor with top-end raid resilience.", rarity: "mythic", price: 4150, kind: "armor", raidDefense: 0.093 }
};

export const SHOP_ITEMS = [
    "scrap", "common_crate", "rare_material_small", "rare_crate", "cosmetic_token", "rare_material", "epic_crate", "tactical_crate", "mythic_crate",
    "field_ration", "repair_kit", "combat_stim", "scav_beacon",
    "rust_blade", "combat_knife", "field_vest", "tactical_armor", "pulse_rifle", "guardian_plate", "scav_smg", "storm_shell",
    "scrap_shotgun", "breach_pistol", "arc_rifle", "volt_smg",
    "aurora_smg", "basilisk_dmr", "nomad_carbon", "bastion_weave",
    "patchwork_rig", "breacher_webbing", "arcskin_vest", "warden_harness"
];

export const COLLECTIBLE_ITEM_IDS = [
    "collector_obsidian_totem",
    "collector_cracked_orrery",
    "collector_warborn_charm",
    "collector_aether_compass",
    "collector_bloodglass_idol",
    "collector_stormseal_coin",
    "collector_hollow_crown",
    "collector_drowned_signet",
    "collector_marrow_lantern",
    "collector_cipher_tablet",
    "collector_voidcarved_urn",
    "collector_riftbone_fang",
    "collector_eternal_halo",
    "collector_omega_reliquary",
    "collector_paradox_shard",
    "collector_blackstar_diadem"
] as const;

export const ULTRA_RARE_COLLECTIBLE_IDS = [
    "collector_eternal_halo",
    "collector_omega_reliquary",
    "collector_paradox_shard",
    "collector_blackstar_diadem"
] as const;

const COLLECTIBLE_ITEM_ID_SET = new Set<string>(COLLECTIBLE_ITEM_IDS);

export function getVendorSellPrice(itemId: string): number {
    if (COLLECTIBLE_ITEM_ID_SET.has(itemId)) return COLLECTIBLE_FIXED_VENDOR_PRICE;
    const item = ITEM_DEFS[itemId];
    if (!item) return 0;
    return Math.max(1, Math.floor(item.price * 0.6));
}

export const WEAPON_IDS = ["rust_blade", "combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade", "scrap_shotgun", "breach_pistol", "hush_repeater", "arc_rifle", "volt_smg", "dune_cutter", "widowmaker_dmr", "magma_caster", "echo_lancer", "grav_pike", "venom_flechette", "rift_carbine", "obsidian_repeater", "siege_cannon", "frostfang_rifle", "stormpiercer", "aurora_smg", "basilisk_dmr", "overclock_minigun", "nebula_glaive", "nullburst_launcher", "phantom_scythe", "sunflare_accelerator", "starforged_reaper", "enhanced_pulse_rifle", "enhanced_marksman_dmr", "enhanced_thermal_lance", "enhanced_plasma_carbine", "enhanced_rail_sniper", "enhanced_reactor_blade", "enhanced_nullburst_launcher", "enhanced_starforged_reaper", "acid_spitter", "caustic_reaper", "hellhound_carbine", "bloodfang_blade", "doom_scepter", "widow_arc", "chaos_staff", "reality_breaker", "eclipse_glaive", "demoncore_lance"];
export const ARMOR_IDS = ["field_vest", "scout_weave", "tactical_armor", "guardian_plate", "storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace", "patchwork_rig", "breacher_webbing", "fogrunner_wrap", "arcskin_vest", "warden_harness", "emberguard_mail", "coastwatch_shell", "nomad_carbon", "nightglass_cloak", "bulwark_plating", "shockframe_suit", "gravebark_mesh", "riftguard_coat", "bastion_weave", "siegebreaker_plate", "hollowbastion", "stormforged_aegis", "cryptsteel_exoshell", "leviathan_shell", "tidelock_panoply", "dreadnought_cuirass", "voidscale_regalia", "eclipse_ward", "sovereign_bastion", "acidbound_shell", "venomward_suit", "hellhide_harness", "doomplate_carapace", "crownfall_raiment", "chaos_mantle", "apocalypse_aegis", "eclipse_bulwark", "demoncore_mail", "wraithveil_hood"];
