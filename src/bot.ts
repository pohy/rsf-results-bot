import {
  type AutocompleteInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  OAuth2Scopes,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { Kysely } from "kysely";
import { makeDb } from "./db/index.js";
import type { Database } from "./db/schema.js";
import { loadBotEnv } from "./env.js";
import { makeLogger } from "./logger.js";
import { fetchRallyName, rallyDetailsUrl, rallyIdFromUrl } from "./results.js";
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
      )
      // Required options must precede optional ones in a Discord command.
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to post this rally's comments in")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addBooleanOption((o) =>
        o
          .setName("send_old_comments")
          .setDescription("Post the rally's existing comment backlog (default: no)")
          .setRequired(false),
      )
      .addBooleanOption((o) =>
        o
          .setName("include_rally_title")
          .setDescription("Include the rally title in this rally's messages (default: no)")
          .setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Stop watching a rally")
      .addIntegerOption((o) =>
        o
          .setName("rally")
          .setDescription("Rally to stop watching")
          .setRequired(true)
          .setAutocomplete(true),
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
  // Default off: a freshly added rally usually has a full comment history we
  // don't want dumped into the channel; only future comments should post.
  const sendOldComments = interaction.options.getBoolean("send_old_comments") ?? false;
  // Default off: comments are split by rally, so the title is redundant unless a
  // channel hosts more than one rally.
  const includeRallyTitle = interaction.options.getBoolean("include_rally_title") ?? false;
  const channelId = interaction.options.getChannel("channel", true).id;
  const added = await addWatched(db, {
    rallyId,
    name,
    addedBy: interaction.user.id,
    addedAt: Date.now(),
    sendOldComments,
    includeRallyTitle,
    channelId,
  });
  await interaction.editReply(
    added
      ? `Now watching **${name}** (${rallyId}) → <#${channelId}>.`
      : `Already watching **${name}** (${rallyId}).`,
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

// Suggest watched rallies for `/watch remove rally`, so the caller picks from a
// list instead of copying an id out of /watch list. Discord caps a response at
// 25 choices; the value is the integer rally id the remove handler expects.
async function handleRemoveAutocomplete(
  db: Kysely<Database>,
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused().toString().toLowerCase();
  const rows = await listWatched(db);
  const matches = rows.filter(
    (r) => r.name.toLowerCase().includes(focused) || String(r.rallyId).includes(focused),
  );
  await interaction.respond(
    matches.slice(0, 25).map((r) => ({ name: `${r.name} (${r.rallyId})`, value: r.rallyId })),
  );
}

async function handleList(
  db: Kysely<Database>,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rows = await listWatched(db);
  // Masked link [name](url) is clickable and doesn't trigger a link-preview embed;
  // <#id> renders the target channel as a mention. Each rally posts its comments
  // into that channel (see watched_rally.channel_id / cron.ts).
  const body =
    rows.length === 0
      ? "No rallies watched."
      : rows
          .map((r) => `• [${r.name}](${rallyDetailsUrl(r.rallyId)}) → <#${r.channelId}>`)
          .join("\n");
  await interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
}

async function main() {
  const env = loadBotEnv();
  const allowed = new Set(env.DISCORD_ALLOWED_USER_IDS);
  const db = makeDb(env);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (ready) => {
    // Print the invite URL first: if the bot isn't in DISCORD_GUILD_ID yet,
    // command registration below fails, so the link must be logged before it.
    // Scopes: bot itself + slash-command registration. Permissions match what
    // it needs — read channels and post results.
    const invite = client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
    logger.log(`invite: ${invite}`);

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
    // Autocomplete: same allowlist gate, but the only response shape is a choice
    // list, so an unauthorized user just gets an empty list.
    if (interaction.isAutocomplete() && interaction.commandName === "watch") {
      if (!allowed.has(interaction.user.id)) {
        await interaction.respond([]);
        return;
      }
      try {
        if (interaction.options.getSubcommand() === "remove") {
          await handleRemoveAutocomplete(db, interaction);
        } else {
          await interaction.respond([]);
        }
      } catch (err) {
        logger.error("watch autocomplete failed:", err);
      }
      return;
    }

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
