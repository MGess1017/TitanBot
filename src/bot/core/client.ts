// The shared discord.js client instance.
import { Client, GatewayIntentBits } from "discord.js";
import { installComponentsV2 } from "../ui/componentsV2";

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

installComponentsV2(client.rest);
