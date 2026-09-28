import { SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

const commands = [];

if (config.features.news) {
  commands.push(
    new SlashCommandBuilder()
      .setName("news-check")
      .setDescription("Newsquellen jetzt prüfen, ohne Meldungen zu veröffentlichen")
      .setDMPermission(false)
  );
}

if (config.features.dkp) {
  commands.push(
    new SlashCommandBuilder()
      .setName("dkp")
      .setDescription("DKP-Verwaltung")
      .addSubcommand(s => s
        .setName("give")
        .setDescription("DKP vergeben")
        .addUserOption(o => o.setName("user").setDescription("Spieler").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("Anzahl DKP").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("reason").setDescription("Grund").setRequired(false)))
      .addSubcommand(s => s
        .setName("remove")
        .setDescription("DKP abziehen")
        .addUserOption(o => o.setName("user").setDescription("Spieler").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("Anzahl DKP").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("reason").setDescription("Grund").setRequired(false)))
      .addSubcommand(s => s
        .setName("set")
        .setDescription("DKP auf einen Wert setzen")
        .addUserOption(o => o.setName("user").setDescription("Spieler").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("Neuer DKP-Wert").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Grund").setRequired(false)))
      .addSubcommandGroup(g => g
        .setName("reset")
        .setDescription("DKP zurücksetzen")
        .addSubcommand(all => all.setName("all").setDescription("DKP aller gespeicherten Spieler auf 0 setzen")))
      .addSubcommand(s => s.setName("balance").setDescription("Eigenen DKP-Stand anzeigen"))
      .addSubcommand(s => s
        .setName("balance-user")
        .setDescription("DKP eines Spielers anzeigen")
        .addUserOption(o => o.setName("user").setDescription("Spieler").setRequired(true)))
      .addSubcommand(s => s.setName("leaderboard").setDescription("DKP-Rangliste anzeigen"))
      .addSubcommand(s => s
        .setName("transactions")
        .setDescription("DKP-Transaktionen anzeigen")
        .addUserOption(o => o.setName("user").setDescription("Optionaler Spieler").setRequired(false))
        .addIntegerOption(o => o.setName("limit").setDescription("Anzahl der Einträge").setMinValue(1).setMaxValue(20).setRequired(false)))
      .addSubcommand(s => s
        .setName("generate-code")
        .setDescription("Einmaligen DKP-Code generieren")
        .addIntegerOption(o => o.setName("amount").setDescription("DKP-Wert des Codes").setRequired(true).setMinValue(1)))
      .addSubcommand(s => s
        .setName("redeem-code")
        .setDescription("DKP-Code einlösen")
        .addStringOption(o => o.setName("code").setDescription("DKP-Code").setRequired(true)))
      .setDMPermission(false)
  );
}

if (config.features.polls) {
  commands.push(
    new SlashCommandBuilder()
      .setName("poll")
      .setDescription("Eine professionelle Abstimmung erstellen")
      .addStringOption(o => o
        .setName("question")
        .setDescription("Die Frage der Abstimmung")
        .setRequired(true)
        .setMaxLength(180))
      .addStringOption(o => o
        .setName("option1")
        .setDescription("Erste Antwortoption")
        .setRequired(true)
        .setMaxLength(80))
      .addStringOption(o => o
        .setName("option2")
        .setDescription("Zweite Antwortoption")
        .setRequired(true)
        .setMaxLength(80))
      .addStringOption(o => o
        .setName("option3")
        .setDescription("Dritte Antwortoption, optional")
        .setRequired(false)
        .setMaxLength(80))
      .addStringOption(o => o
        .setName("option4")
        .setDescription("Vierte Antwortoption, optional")
        .setRequired(false)
        .setMaxLength(80))
      .addStringOption(o => o
        .setName("option5")
        .setDescription("Fünfte Antwortoption, optional")
        .setRequired(false)
        .setMaxLength(80))
      .addIntegerOption(o => o
        .setName("duration")
        .setDescription("Dauer in Stunden (1–168), optional")
        .setMinValue(1)
        .setMaxValue(168)
        .setRequired(false))
      .addBooleanOption(o => o
        .setName("multiple")
        .setDescription("Mehrere Antwortoptionen pro Teilnehmer erlauben")
        .setRequired(false))
      .setDMPermission(false)
  );
}

export { commands };
