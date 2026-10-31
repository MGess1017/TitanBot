import assert from "node:assert/strict";
import {
    buildTemporaryVoiceControlRow,
    buildTemporaryVoiceModal,
    buildTemporaryVoiceRoomName,
    getTemporaryVoiceOwnerId,
    parseTemporaryVoiceControlId,
    parseTemporaryVoiceModalId
} from "../features/temporaryVoice";

const ownerId = "123456789012345678";
const roomName = buildTemporaryVoiceRoomName("Captain Nova", ownerId);
assert.equal(roomName, `temp-vc-captain-nova-${ownerId}`);
assert.equal(getTemporaryVoiceOwnerId(roomName), ownerId);
assert.equal(getTemporaryVoiceOwnerId("temp-vc-unmarked-room"), null);

const row = buildTemporaryVoiceControlRow({ channelId: "223456789012345678", ownerId, locked: false, userLimit: 0 }).toJSON();
assert.equal(row.components.length, 4);
assert.ok(row.components.some(component => component.label === "Rename"));
assert.ok(row.components.some(component => component.label === "Lock"));
assert.ok(row.components.some(component => component.label === "Set limit"));
assert.ok(row.components.some(component => component.label === "Transfer"));
assert.deepEqual(parseTemporaryVoiceControlId(row.components[0].custom_id), {
    action: "rename",
    channelId: "223456789012345678",
    ownerId
});

const renameModal = buildTemporaryVoiceModal("rename", "223456789012345678", ownerId).toJSON();
assert.equal(renameModal.components[0].components[0].custom_id, "value");
assert.deepEqual(parseTemporaryVoiceModalId(renameModal.custom_id), {
    action: "rename",
    channelId: "223456789012345678",
    ownerId
});
assert.equal(parseTemporaryVoiceModalId(`temporary_vc_modal:rename:bad:${ownerId}`), null);
console.log("temporary voice controls tests passed");