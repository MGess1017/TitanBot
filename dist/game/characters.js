"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCharacterById = getCharacterById;
exports.getAllCharacters = getAllCharacters;
const characters = [
    {
        id: 'scavenger',
        name: 'Scavenger',
        health: 100,
        stamina: 100,
        strength: 5,
        agility: 7,
        intelligence: 4,
        specialAbility: 'Loot Finder',
        description: 'A nimble character adept at scavenging for supplies and evading danger.'
    },
    {
        id: 'raider',
        name: 'Raider',
        health: 120,
        stamina: 80,
        strength: 8,
        agility: 5,
        intelligence: 6,
        specialAbility: 'Ambush',
        description: 'A fierce combatant skilled in ambush tactics and close-quarters combat.'
    },
    {
        id: 'medic',
        name: 'Medic',
        health: 90,
        stamina: 100,
        strength: 4,
        agility: 6,
        intelligence: 8,
        specialAbility: 'Heal',
        description: 'A support character capable of healing wounds and reviving teammates.'
    },
    {
        id: 'sniper',
        name: 'Sniper',
        health: 80,
        stamina: 90,
        strength: 6,
        agility: 8,
        intelligence: 9,
        specialAbility: 'Long Shot',
        description: 'A sharpshooter who excels at taking out enemies from a distance.'
    }
];
function getCharacterById(id) {
    return characters.find(character => character.id === id);
}
function getAllCharacters() {
    return characters;
}
