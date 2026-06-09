import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { Kysely } from "kysely";
import { makeDb } from "./db/index.js";
import type { Database } from "./db/schema.js";
import { loadBotEnv } from "./env.js";
import { makeLogger } from "./logger.js";
import { fetchRallyName, rallyIdFromUrl } from "./results.js";
import { addWatched, listWatched, removeWatched } from "./watched.js";

// Discord bot for managing the watched-rally list. Gateway connection (not a
// webhook) so it can receive slash commands. It only reads/writes watched_rally
// and reads public rally pages — it never scrapes or posts results.

const logger = makeLogger("bot");

const watchCommand = new SlashCommandBuilder()
  .setName("watch")
  .setDescription("Manage watched rallies")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Watch a rally by its URL")
      .addStringOption((o) =>
        o.setName("url").setDescription("Rally URL from rallysimfans.hu").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Stop watching a rally")
      .addIntegerOption((o) =>
        o.setName("rally").setDescription("Rally id (from /watch list)").setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List watched rallies"));

async function handleAdd(
  db: Kysely<Database>,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Defer: fetching the rally page can take longer than Discord's 3s reply window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rallyId = rallyIdFromUrl(interaction.options.getString("url", true));
  if (rallyId === null) {
    await interaction.editReply("Couldn't find a `rally_id` in that URL.");
    return;
  }
  const name = await fetchRallyName(rallyId);
  if (!name) {
    await interaction.editReply(`Couldn't read the rally name for ${rallyId}. Not added.`);
    return;
  }
  const added = await addWatched(db, {
    rallyId,
    name,
    addedBy: interaction.user.id,
    addedAt: Date.now(),
  });
  await interaction.editReply(
    added ? `Now watching **${name}** (${rallyId}).` : `Already watching **${name}** (${rallyId}).`,
  );
}

async function handleRemove(
  db: Kysely<Database>,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rallyId = interaction.options.getInteger("rally", true);
  const removed = await removeWatched(db, rallyId);
  await interaction.reply({
    content: removed ? `Removed rally ${rallyId}.` : `Rally ${rallyId} wasn't being watched.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(
  db: Kysely<Database>,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rows = await listWatched(db);
  const body =
    rows.length === 0
      ? "No rallies watched."
      : rows.map((r) => `• **${r.name}** (${r.rallyId})`).join("\n");
  await interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
}

async function main() {
  const env = loadBotEnv();
  const allowed = new Set(env.DISCORD_ALLOWED_USER_IDS);
  const db = makeDb(env);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (ready) => {
    // Register commands on startup, guild-scoped: idempotent and propagates
    // instantly (global registration would take ~1h).
    const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DISCORD_GUILD_ID), {
      body: [watchCommand.toJSON()],
    });
    logger.log(
      `bot ready as ${ready.user.tag}; /watch registered to guild ${env.DISCORD_GUILD_ID}`,
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "watch") return;

    // Gate every command to the allowlist.
    if (!allowed.has(interaction.user.id)) {
      await interaction.reply({ content: "Not authorized.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") await handleAdd(db, interaction);
      else if (sub === "remove") await handleRemove(db, interaction);
      else if (sub === "list") await handleList(db, interaction);
    } catch (err) {
      logger.error("watch command failed:", err);
      const msg = "Command failed. Try again.";
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  });

  await client.login(env.DISCORD_BOT_TOKEN);
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
