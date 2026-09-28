import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  ButtonStyle,
  MessageFlags
} from "discord.js";
import { fileURLToPath } from "node:url";
import { startNewsFeed, refreshLatestNewsCards } from "./news/index.js";

import { config } from "./config.js";
import { createPoll, getPoll, getAllPolls, votePoll, closePoll, reopenPoll, setPollMessageId, setPollResultMessageId } from "./poll-store.js";
import {
  getBalance,
  changeDkp,
  setDkp,
  resetAll,
  getLeaderboard,
  getTransactions,
  generateCode,
  redeemCode
} from "./store.js";

const GOLD = 0xF2C94C;
const GREEN = 0x57F287;
const RED = 0xED4245;
const DARK_GOLD = 0xC89B2C;

const POLL_COLOR = 0xE89A32;
const POLL_BANNER = fileURLToPath(new URL("../assets/Banner-Schatzmeister.png", import.meta.url));
const resultPostsInFlight = new Map();
const POLL_OPTION_COLORS = [
  ButtonStyle.Primary,
  ButtonStyle.Success,
  ButtonStyle.Secondary,
  ButtonStyle.Primary,
  ButtonStyle.Success
];

function isPollAdmin(interaction) {
  const roles = interaction.member?.roles;
  const memberRoleIds = roles?.cache
    ? [...roles.cache.keys()]
    : Array.isArray(roles) ? roles : [];

  return config.pollAdminUserIds.includes(interaction.user.id) ||
    config.pollAdminRoleIds.some(id => memberRoleIds.includes(id));
}

function requirePollAdmin(interaction) {
  if (!isPollAdmin(interaction)) {
    throw new Error("Du hast keine Berechtigung für Poll-Administration.");
  }
}


function formatPollDuration(closesAt) {
  if (!closesAt) return "Keine automatische Schließung";
  return `<t:${Math.floor(new Date(closesAt).getTime() / 1000)}:R>`;
}

function buildPollEmbed(poll) {
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes.length, 0);
  const participantCount = new Set(poll.options.flatMap(option => option.votes)).size;
  const fields = poll.options.map((option, index) => {
    const votes = option.votes.length;
    const percent = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
    const voters = option.votes.slice(0, 30).map(id => `<@${id}>`).join(", ");
    const additionalVoters = option.votes.length > 30 ? ` … +${option.votes.length - 30}` : "";
    return {
      name: `${index + 1}. ${option.label}`,
      value: `**${votes}** Stimme${votes === 1 ? "" : "n"} · ${percent}%\n${option.votes.length ? `Gewählt von: ${voters}${additionalVoters}` : "Noch keine Stimmen"}\n\u200B`,
      inline: false
    };
  });

  return new EmbedBuilder()
    .setAuthor({ name: "📊 GILDENABSTIMMUNG" })
    .setTitle(poll.question)
    .setDescription(poll.allowMultiple
      ? "> **Mehrfachauswahl** · mehrere Antworten möglich.\n> Erneuter Klick hebt eine Auswahl auf."
      : "> Wähle eine Antwort aus.")
    .addFields(
      ...fields,
      {
        name: "Teilnehmer",
        value: `**${participantCount}**${poll.allowMultiple ? ` · ${totalVotes} Auswahl${totalVotes === 1 ? "" : "en"}` : ` Stimme${participantCount === 1 ? "" : "n"}`}`,
        inline: true
      },
      {
        name: poll.closed ? "Status" : "Endet",
        value: poll.closed ? "🔒 Geschlossen" : formatPollDuration(poll.closesAt),
        inline: true
      }
    )
    .setColor(POLL_COLOR)
    .setFooter({ text: `Erstellt von ${poll.creatorName}` })
    .setTimestamp(new Date(poll.createdAt));
}

function buildPollBannerEmbed() {
  return new EmbedBuilder()
    .setColor(POLL_COLOR)
    .setImage("attachment://Banner-Schatzmeister.png");
}

function buildPollEmbeds(poll) {
  return [buildPollBannerEmbed(), buildPollEmbed(poll)];
}

function buildPollComponents(poll) {
  const optionRow = new ActionRowBuilder().addComponents(
    ...poll.options.map((option, index) =>
      new ButtonBuilder()
        .setCustomId(`poll_vote:${poll.id}:${option.id}`)
        .setLabel(option.label.slice(0, 80))
        .setStyle(POLL_OPTION_COLORS[index])
        .setDisabled(poll.closed)
    )
  );

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`poll_close:${poll.id}`).setLabel("Abstimmung schließen").setEmoji("⏹️").setStyle(ButtonStyle.Secondary).setDisabled(poll.closed),
    new ButtonBuilder().setCustomId(`poll_participants:${poll.id}`).setLabel("Teilnehmer anzeigen").setEmoji("👥").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`poll_reopen:${poll.id}`).setLabel("Wieder öffnen").setEmoji("🔓").setStyle(ButtonStyle.Success).setDisabled(!poll.closed)
  );

  return [optionRow, closeRow];
}

async function updatePollMessage(poll) {
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(poll.messageId).catch(() => null);
  if (!message) return;
  await message.edit({
    embeds: buildPollEmbeds(poll),
    components: buildPollComponents(poll),
    attachments: [],
    allowedMentions: { parse: [] },
    files: [new AttachmentBuilder(POLL_BANNER, { name: "Banner-Schatzmeister.png" })]
  }).catch(() => {});
}

function buildPollResult(poll) {
  const counts = poll.options.map(option => ({ label: option.label, votes: option.votes.length }));
  const maxVotes = Math.max(0, ...counts.map(item => item.votes));
  const winners = maxVotes ? counts.filter(item => item.votes === maxVotes) : [];
  const formatVoters = option => {
    const visible = option.votes.slice(0, 30).map(id => `<@${id}>`);
    if (option.votes.length > visible.length) visible.push(`… +${option.votes.length - visible.length} weitere`);
    return visible.length ? visible.join(", ") : "keine Stimmen";
  };
  const outcome = !winners.length ? "Es wurden keine Stimmen abgegeben." : winners.length > 1
    ? `Gleichstand: ${winners.map(item => `**${item.label}**`).join(", ")} (${maxVotes} Stimmen je Option; Abstimmende: ${winners.flatMap(item => poll.options.find(option => option.label === item.label)?.votes || []).filter((id, index, all) => all.indexOf(id) === index).slice(0, 30).map(id => `<@${id}>`).join(", ")})`
    : `Gewonnen hat **${winners[0].label}** mit **${maxVotes}** Stimme${maxVotes === 1 ? "" : "n"}.`;
  const fields = poll.options.map(option => ({
    name: option.label,
    value: `**${option.votes.length}** Stimme${option.votes.length === 1 ? "" : "n"}: ${formatVoters(option)}`,
    inline: false
  }));
  const resultEmbed = new EmbedBuilder()
    .setAuthor({ name: "🏆 GILDENABSTIMMUNG BEENDET" })
    .setTitle(poll.question)
    .setDescription(outcome)
    .addFields(fields)
    .setColor(POLL_COLOR)
    .setTimestamp(new Date(poll.closedAt || Date.now()));
  return { embeds: [resultEmbed], allowedMentions: { parse: [] } };
}

async function postPollResult(poll) {
  if (!poll?.closed || poll.resultMessageId) return;
  if (resultPostsInFlight.has(poll.id)) return resultPostsInFlight.get(poll.id);
  const task = (async () => {
    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.send(buildPollResult(poll));
    setPollResultMessageId(poll.id, message.id);
  })();
  resultPostsInFlight.set(poll.id, task);
  try { await task; } finally { resultPostsInFlight.delete(poll.id); }
}

async function removePollResult(poll) {
  if (!poll.resultMessageId) return;
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  const message = channel?.isTextBased() ? await channel.messages.fetch(poll.resultMessageId).catch(() => null) : null;
  if (message) await message.delete().catch(() => {});
}

function buildPollPost(poll) {
  return { embeds: buildPollEmbeds(poll), components: buildPollComponents(poll), allowedMentions: { parse: [] }, files: [new AttachmentBuilder(POLL_BANNER, { name: "Banner-Schatzmeister.png" })] };
}

function schedulePollClose(poll) {
  if (poll.closed || !poll.closesAt) return;
  const delay = new Date(poll.closesAt).getTime() - Date.now();
  if (delay <= 0) {
    const closed = closePoll(poll.id);
    void updatePollMessage(closed).then(() => postPollResult(closed));
    return;
  }
  setTimeout(async () => {
    try {
      const current = getPoll(poll.id);
      if (!current || current.closed) return;
      const closed = closePoll(poll.id);
      await updatePollMessage(closed);
      await postPollResult(closed);
    } catch (error) {
      console.error("Fehler beim automatischen Schließen einer Abstimmung:", error);
    }
  }, delay);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isDkpAdmin(interaction) {
  if (interaction.memberPermissions?.has("Administrator")) return true;
  if (config.adminUserIds.includes(interaction.user.id)) return true;

  const memberRoleIds = interaction.member?.roles?.cache
    ? [...interaction.member.roles.cache.keys()]
    : [];

  return config.adminRoleIds.some(id => memberRoleIds.includes(id));
}

function requireDkpAdmin(interaction) {
  if (!isDkpAdmin(interaction)) {
    throw new Error("Du hast keine Berechtigung, DKP zu verwalten.");
  }
}

function userName(user) {
  return user.globalName || user.username;
}

async function sendLog(interaction, text) {
  if (!config.logChannelId) return;
  const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(text).catch(() => {});
}

client.once(Events.ClientReady, ready => {
  console.log(`✓ Schatzmeister Bot online: ${ready.user.tag}`);

  if (config.features.polls) {
    for (const poll of getAllPolls().filter(poll => !poll.closed)) {
      schedulePollClose(poll);
    }
    for (const poll of getAllPolls().filter(poll => poll.closed && !poll.resultMessageId)) void postPollResult(poll);
  }

  if (config.features.news) {
    void startNewsFeed(client, config).catch(error => {
      console.error("Newsfeed konnte nicht gestartet werden:", error);
    });
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "news-check") {
      if (!config.features.news) {
        return interaction.reply({ content: "Der Newsfeed ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
      }
      requireDkpAdmin(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const refreshResult = await refreshLatestNewsCards(client, config);
      const result = { sourceResults: refreshResult.sourceResults, skippedSources: refreshResult.skippedSources };
      const actionText = refreshResult.recreated
        ? `${refreshResult.recreated} letzte News-Karten chronologisch neu aufgebaut`
        : `${refreshResult.updated} letzte News-Karten aktualisiert`;
      const lines = [`**Manueller Newsquellen-Check** · ${actionText}; weitere neue Meldungen werden weiterhin automatisch gepostet.`];
      for (const source of result.sourceResults || []) {
        if (source.ok) {
          lines.push(`✅ **${source.name}** — erreichbar · ${source.count} aktuelle Treffer`);
          for (const title of source.titles || []) lines.push(`> ${title.slice(0, 160)}`);
        } else {
          lines.push(`❌ **${source.name}** — ${source.error}`);
        }
      }
      for (const source of result.skippedSources || []) {
        lines.push(`⏭️ **${source.source}** — übersprungen: ${source.reason}`);
      }
      return interaction.editReply({ content: lines.join("\n").slice(0, 1950), allowedMentions: { parse: [] } });
    }

    if (interaction.commandName === "poll") {
      if (!config.features.polls) {
        return interaction.reply({ content: "Der Poll-Bereich ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
      }

      requirePollAdmin(interaction);

      const question = interaction.options.getString("question", true).trim();
      const options = [1, 2, 3, 4, 5]
        .map(index => interaction.options.getString(`option${index}`)?.trim())
        .filter(Boolean);
      if (options.length < 2) {
        throw new Error("Eine Abstimmung benötigt mindestens 2 Antwortoptionen.");
      }
      if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
        throw new Error("Die Antwortoptionen müssen eindeutig sein.");
      }
      const durationHours = interaction.options.getInteger("duration") || null;
      const allowMultiple = interaction.options.getBoolean("multiple") || false;

      const poll = createPoll({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        messageId: "pending",
        question,
        options,
        creatorId: interaction.user.id,
        creatorName: userName(interaction.user),
        durationHours,
        allowMultiple
      });

      await interaction.reply({
        ...buildPollPost(poll)
      });

      const message = await interaction.fetchReply();
      const savedPoll = setPollMessageId(poll.id, message.id);
      schedulePollClose(savedPoll);
      return;
    }

    if (interaction.commandName !== "dkp") return;
    if (!config.features.dkp) {
      return interaction.reply({ content: "Der DKP-Bereich ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup();

    if (
      sub === "give" ||
      sub === "remove" ||
      sub === "set" ||
      sub === "generate-code" ||
      group === "reset"
    ) {
      requireDkpAdmin(interaction);
    }

    const dkpReplyIsEphemeral =
      sub === "balance" || sub === "redeem-code" || group === "reset";
    await interaction.deferReply(
      dkpReplyIsEphemeral ? { flags: MessageFlags.Ephemeral } : {}
    );

    if (sub === "give" || sub === "remove") {
      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const reason =
        interaction.options.getString("reason") || "Kein Grund angegeben";

      const signedAmount = sub === "give" ? amount : -amount;

      const result = changeDkp(
        interaction.guildId,
        user.id,
        userName(user),
        signedAmount,
        reason,
        interaction.user.id,
        userName(interaction.user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              sub === "give" ? "🪙 DKP vergeben" : "🪙 DKP abgezogen"
            )
            .setDescription(
              `**${userName(user)}** ${
                sub === "give" ? "erhält" : "verliert"
              } **${amount} DKP**.`
            )
            .addFields(
              { name: "Grund", value: reason },
              {
                name: "Neuer Kontostand",
                value: `**${result.balance} DKP**`,
                inline: true
              },
              {
                name: "Bearbeitet von",
                value: interaction.user.toString(),
                inline: true
              }
            )
            .setColor(sub === "give" ? GOLD : RED)
            .setTimestamp()
        ]
      });

      await sendLog(
        interaction,
        `🪙 **DKP ${
          sub === "give" ? "vergeben" : "abgezogen"
        }**\n${userName(user)}: ${
          signedAmount > 0 ? "+" : ""
        }${signedAmount} DKP\nGrund: ${reason}\nVon: ${userName(
          interaction.user
        )}`
      );

      return;
    }

    if (sub === "set") {
      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const reason =
        interaction.options.getString("reason") || "DKP direkt gesetzt";

      const result = setDkp(
        interaction.guildId,
        user.id,
        userName(user),
        amount,
        reason,
        interaction.user.id,
        userName(interaction.user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🪙 DKP gesetzt")
            .setDescription(
              `**${userName(user)}** hat jetzt **${result.balance} DKP**.`
            )
            .addFields({ name: "Grund", value: reason })
            .setColor(GOLD)
            .setTimestamp()
        ]
      });

      await sendLog(
        interaction,
        `🪙 **DKP gesetzt**\n${userName(user)}: **${result.balance} DKP**\nGrund: ${reason}\nVon: ${userName(
          interaction.user
        )}`
      );

      return;
    }

    if (group === "reset") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dkp_reset_confirm:${interaction.user.id}`)
          .setLabel("Alle DKP zurücksetzen")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`dkp_reset_cancel:${interaction.user.id}`)
          .setLabel("Abbrechen")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content:
          "⚠️ **Achtung:** Dadurch werden die DKP aller gespeicherten Spieler auf **0** gesetzt.",
        components: [row]
      });

      return;
    }

    if (sub === "balance") {
      const balance = getBalance(
        interaction.guildId,
        interaction.user.id,
        userName(interaction.user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🪙 Dein DKP")
            .setDescription(`Du hast aktuell **${balance} DKP**.`)
            .setColor(GOLD)
        ]
      });

      return;
    }

    if (sub === "balance-user") {
      const user = interaction.options.getUser("user", true);
      const balance = getBalance(
        interaction.guildId,
        user.id,
        userName(user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🪙 DKP-Kontostand")
            .setDescription(
              `**${userName(user)}** hat aktuell **${balance} DKP**.`
            )
            .setColor(GOLD)
        ]
      });

      return;
    }

    if (sub === "leaderboard") {
      const rows = getLeaderboard(interaction.guildId);

      if (!rows.length) {
        return interaction.editReply("Noch keine DKP-Daten vorhanden.");
      }

      const medals = ["🥇", "🥈", "🥉"];

      const text = rows
        .slice(0, 20)
        .map(
          (row, i) =>
            `${medals[i] || `**${i + 1}.**`} **${
              row.username || row.userId
            }** — **${row.dkp} DKP**`
        )
        .join("\n");

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 DKP-Leaderboard")
            .setDescription(text)
            .setColor(GOLD)
            .setTimestamp()
        ]
      });

      return;
    }

    if (sub === "transactions") {
      const user = interaction.options.getUser("user");
      const limit = interaction.options.getInteger("limit") || 10;

      const rows = getTransactions(
        interaction.guildId,
        user?.id,
        limit
      );

      if (!rows.length) {
        return interaction.editReply("Keine Transaktionen gefunden.");
      }

      const text = rows
        .map(row => {
          const sign = row.amount > 0 ? "+" : "";
          const date = new Date(row.timestamp).toLocaleString("de-DE");

          return `**${sign}${row.amount} DKP** — ${
            row.username
          }\n${row.reason}\n\`${date}\` · ${row.actorName}`;
        })
        .join("\n\n");

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📜 DKP-Transaktionen")
            .setDescription(text.slice(0, 4000))
            .setColor(DARK_GOLD)
            .setTimestamp()
        ]
      });

      return;
    }

    if (sub === "generate-code") {
      const amount = interaction.options.getInteger("amount", true);

      const code = generateCode(
        interaction.guildId,
        amount,
        interaction.user.id,
        userName(interaction.user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎟️ DKP-Code erstellt")
            .setDescription(`**\`${code}\`**`)
            .addFields(
              {
                name: "Wert",
                value: `**${amount} DKP**`,
                inline: true
              },
              {
                name: "Status",
                value: "Nicht eingelöst",
                inline: true
              }
            )
            .setColor(GOLD)
            .setFooter({
              text: "Der Code kann nur einmal eingelöst werden."
            })
            .setTimestamp()
        ]
      });

      await sendLog(
        interaction,
        `🎟️ **DKP-Code erstellt**\nCode: \`${code}\`\nWert: **${amount} DKP**\nErstellt von: ${userName(
          interaction.user
        )}`
      );

      return;
    }

    if (sub === "redeem-code") {
      const code = interaction.options.getString("code", true);

      const result = redeemCode(
        interaction.guildId,
        code,
        interaction.user.id,
        userName(interaction.user)
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎟️ DKP-Code eingelöst")
            .setDescription(
              `Du hast **${result.amount} DKP** erhalten.`
            )
            .addFields({
              name: "Neuer Kontostand",
              value: `**${result.balance} DKP**`
            })
            .setColor(GREEN)
            .setTimestamp()
        ],
        flags: MessageFlags.Ephemeral
      });

      await sendLog(
        interaction,
        `🎟️ **DKP-Code eingelöst**\n${userName(
          interaction.user
        )}: **+${result.amount} DKP**\nNeuer Kontostand: **${result.balance} DKP**`
      );
    }
  } catch (error) {
    console.error(error);

    const payload = {
      content: `❌ ${error?.message || "Unbekannter Fehler."}`,
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("poll_vote:")) {
    if (!config.features.polls) {
      return interaction.reply({
        content: "Der Poll-Bereich ist derzeit deaktiviert.",
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const [, pollId, optionId] = interaction.customId.split(":");
      const poll = votePoll(pollId, interaction.user.id, optionId);
      await interaction.update({
        embeds: buildPollEmbeds(poll),
        components: buildPollComponents(poll),
        attachments: [],
        allowedMentions: { parse: [] },
        files: [new AttachmentBuilder(POLL_BANNER, { name: "Banner-Schatzmeister.png" })]
      });
    } catch (error) {
      const [, pollId] = interaction.customId.split(":");
      const expiredPoll = getPoll(pollId);
      if (expiredPoll?.closed) {
        await updatePollMessage(expiredPoll);
        await postPollResult(expiredPoll);
      }
      await interaction.reply({
        content: `❌ ${error?.message || "Die Stimme konnte nicht verarbeitet werden."}`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith("poll_close:")) {
    if (!config.features.polls) {
      return interaction.reply({
        content: "Der Poll-Bereich ist derzeit deaktiviert.",
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const [, pollId] = interaction.customId.split(":");
      const poll = getPoll(pollId);
      if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");

      if (!isPollAdmin(interaction)) {
        return interaction.reply({
          content: "Nur ein Poll-Admin kann diese Abstimmung schließen.",
          flags: MessageFlags.Ephemeral
        });
      }

      const closed = closePoll(pollId);
      await interaction.update({
        embeds: buildPollEmbeds(closed),
        components: buildPollComponents(closed),
        attachments: [],
        allowedMentions: { parse: [] },
        files: [new AttachmentBuilder(POLL_BANNER, { name: "Banner-Schatzmeister.png" })]
      });
      await postPollResult(closed);
    } catch (error) {
      await interaction.reply({
        content: `❌ ${error?.message || "Die Abstimmung konnte nicht geschlossen werden."}`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith("poll_reopen:")) {
    if (!config.features.polls) return interaction.reply({ content: "Der Poll-Bereich ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
    if (!isPollAdmin(interaction)) return interaction.reply({ content: "Nur Poll-Admins können Abstimmungen wieder öffnen.", flags: MessageFlags.Ephemeral });
    const [, pollId] = interaction.customId.split(":");
    const poll = getPoll(pollId);
    if (!poll?.closed) return interaction.reply({ content: "Diese Abstimmung ist bereits geöffnet oder existiert nicht mehr.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`poll_reopen_modal:${pollId}`).setTitle("Abstimmung wieder öffnen");
    const duration = new TextInputBuilder().setCustomId("duration").setLabel("Neue Laufzeit in Stunden (1–168)").setStyle(TextInputStyle.Short).setPlaceholder("24").setRequired(true).setMinLength(1).setMaxLength(3);
    modal.addComponents(new ActionRowBuilder().addComponents(duration));
    return interaction.showModal(modal);
  }

  if (interaction.customId.startsWith("poll_participants:")) {
    if (!config.features.polls) return interaction.reply({ content: "Der Poll-Bereich ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
    if (!isPollAdmin(interaction)) return interaction.reply({ content: "Nur Poll-Admins können die Teilnehmer anzeigen.", flags: MessageFlags.Ephemeral });
    const [, pollId] = interaction.customId.split(":");
    const poll = getPoll(pollId);
    if (!poll) return interaction.reply({ content: "Diese Abstimmung existiert nicht mehr.", flags: MessageFlags.Ephemeral });
    const description = poll.options.map(option => {
      const voters = option.votes.map(id => `<@${id}>`);
      const shown = voters.slice(0, 45);
      if (voters.length > shown.length) shown.push(`… und ${voters.length - shown.length} weitere`);
      return `**${option.label}** (${voters.length})\n${shown.length ? shown.join(", ") : "Noch keine Stimmen"}`;
    }).join("\n\n").slice(0, 4000);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("👥 Abstimmungsteilnehmer").setDescription(description).setColor(POLL_COLOR)], allowedMentions: { parse: [] } });
  }

  const [action, userId] = interaction.customId.split(":");

  if (!action.startsWith("dkp_reset_")) return;

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: "Diese Bestätigung gehört zu einer anderen Person.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === "dkp_reset_cancel") {
    return interaction.update({
      content: "Reset abgebrochen.",
      components: []
    });
  }

  if (action === "dkp_reset_confirm") {
    if (!isDkpAdmin(interaction)) {
      return interaction.update({
        content: "Du hast keine Berechtigung für diesen Vorgang.",
        components: []
      });
    }

    const affected = resetAll(
      interaction.guildId,
      interaction.user.id,
      userName(interaction.user)
    );

    await interaction.update({
      content: `✅ Alle DKP wurden zurückgesetzt.\nBetroffene Spieler: **${affected}**`,
      components: []
    });

    await sendLog(
      interaction,
      `♻️ **Alle DKP zurückgesetzt**\nBetroffene Spieler: ${affected}\nVon: ${userName(
        interaction.user
      )}`
    );
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith("poll_reopen_modal:")) return;
  if (!config.features.polls) return interaction.reply({ content: "Der Poll-Bereich ist derzeit deaktiviert.", flags: MessageFlags.Ephemeral });
  if (!isPollAdmin(interaction)) return interaction.reply({ content: "Nur Poll-Admins können Abstimmungen wieder öffnen.", flags: MessageFlags.Ephemeral });
  try {
    const [, pollId] = interaction.customId.split(":");
    const durationHours = Number(interaction.fields.getTextInputValue("duration").trim());
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168) throw new Error("Bitte gib eine ganze Zahl zwischen 1 und 168 Stunden ein.");
    const previous = getPoll(pollId);
    if (!previous?.closed) throw new Error("Diese Abstimmung ist bereits geöffnet oder existiert nicht mehr.");
    await removePollResult(previous);
    const poll = reopenPoll(pollId, durationHours);
    await updatePollMessage(poll);
    schedulePollClose(poll);
    await interaction.reply({ content: `🔓 Abstimmung wieder geöffnet. Alle bisherigen Stimmen bleiben erhalten; sie endet <t:${Math.floor(new Date(poll.closesAt).getTime() / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
  } catch (error) {
    await interaction.reply({ content: `❌ ${error?.message || "Die Abstimmung konnte nicht geöffnet werden."}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(config.token);
