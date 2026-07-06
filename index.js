const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("FSE Bot is running!");
});

app.listen(PORT, () => {
    console.log(`Web server started on port ${PORT}`);
});

require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();
const ms = require("ms");
const path = require("path");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const QUARANTINE_ROLE_ID = process.env.QUARANTINE_ROLE_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !QUARANTINE_ROLE_ID || !ANNOUNCE_CHANNEL_ID) {
    console.error("Missing .env values. Please fill DISCORD_TOKEN, CLIENT_ID, GUILD_ID, QUARANTINE_ROLE_ID, ANNOUNCE_CHANNEL_ID");
    process.exit(1);
}

const dbDir = path.join(__dirname, "database");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new sqlite3.Database(path.join(dbDir, "punishments.db"));

db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS punishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      announce_channel_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration_text TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName("quarantine")
        .setDescription("Temporarily quarantine a user.")
        .addUserOption(option =>
            option.setName("user").setDescription("User to quarantine").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("duration").setDescription("Example: 3d, 12h, 30m").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason").setDescription("Reason for quarantine").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("team").setDescription("Team name").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),
];

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    try {
        console.log("Registering slash commands...");
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log("Slash commands registered.");
    } catch (error) {
        console.error("Failed to register commands:", error);
    }
}

function makeBanEmbed(member, durationText, reason, team, moderatorTag, expiresAt) {
    return new EmbedBuilder()
        .setColor("#ff0000")
        .setAuthor({
            name: "Final Strike Esports",
            iconURL: member.guild.iconURL({ dynamic: true }) || undefined,
        })
        .setTitle(" BAN TEAM ")
        .setDescription(
            " ```This Team is Ban in All T2 Scrims```"
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
        .addFields(
            {
                name: "👤 Player",
                value: `${member}\n\`${member.user.tag}\``,
                inline: false,
            },
            {
                name: "🏷 Team",
                value: `**${team}**`,
                inline: true,
            },
            {
                name: "⏳ Duration",
                value: `**${durationText}**`,
                inline: true,
            },
            {
                name: "📝 Reason",
                value: reason,
                inline: true,
            },
            {
                name: "🛡 Moderator",
                value: moderatorTag,
                inline: false,
            },
            {
                name: "📅 Ends",
                value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`,
                inline: false,
            }
        )
        .setFooter({
            text: "Final Strike Esports • Moderation System",
        })
        .setTimestamp();
}

function makeUnbanEmbed(userId, reason) {
    return new EmbedBuilder()
        .setColor("#00ff66")
        .setAuthor({
            name: "Final Strike Esports",
        })
        .setTitle("✅ TEAM UNBANNED")
        .setDescription("The quarantine duration has ended.")
        .addFields(
            {
                name: "👤 Player",
                value: `<@${userId}>`,
                inline: false,
            },
            {
                name: "📋 Previous Reason",
                value: reason,
                inline: false,
            },
            {
                name: "✔ Status",
                value: "Quarantine Removed Automatically",
                inline: false,
            }
        )
        .setFooter({
            text: "Final Strike Esports • Moderation System",
        })
        .setTimestamp();
}

function savePunishment(data) {
    const {
        guildId,
        userId,
        roleId,
        announceChannelId,
        moderatorId,
        reason,
        durationText,
        expiresAt,
    } = data;

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO punishments (
        guild_id, user_id, role_id, announce_channel_id, moderator_id, reason, duration_text, expires_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                guildId,
                userId,
                roleId,
                announceChannelId,
                moderatorId,
                reason,
                durationText,
                expiresAt,
            ],
            function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

function getActivePunishment(guildId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM punishments
       WHERE guild_id = ? AND user_id = ? AND active = 1
       ORDER BY expires_at DESC
       LIMIT 1`,
            [guildId, userId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            }
        );
    });
}

function getExpiredPunishments() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM punishments
       WHERE active = 1 AND expires_at <= ?`,
            [Date.now()],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

function markInactive(id) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE punishments SET active = 0 WHERE id = ?`,
            [id],
            (err) => {
                if (err) return reject(err);
                resolve();
            }
        );
    });
}

async function processExpiredPunishments() {
    try {
        const rows = await getExpiredPunishments();
        if (rows.length === 0) return;

        for (const row of rows) {
            const guild = client.guilds.cache.get(row.guild_id);
            if (!guild) {
                await markInactive(row.id);
                continue;
            }

            const member = await guild.members.fetch(row.user_id).catch(() => null);
            const announceChannel = guild.channels.cache.get(row.announce_channel_id);

            await markInactive(row.id);

            if (member) {
                await member.roles.remove(row.role_id).catch(() => null);
            }

            if (announceChannel && announceChannel.isTextBased()) {
                const unbanEmbed = makeUnbanEmbed(row.user_id, row.reason);
                await announceChannel.send({ embeds: [unbanEmbed] }).catch(() => null);
            }
        }
    } catch (error) {
        console.error("Error while processing expired punishments:", error);
    }
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();

    await processExpiredPunishments();
    setInterval(processExpiredPunishments, 15000);
});

client.on("guildMemberAdd", async (member) => {
    try {
        const row = await getActivePunishment(member.guild.id, member.id);
        if (!row) return;

        if (row.expires_at <= Date.now()) {
            await markInactive(row.id);
            return;
        }

        await member.roles.add(row.role_id).catch(() => null);
    } catch (error) {
        console.error("guildMemberAdd error:", error);
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "quarantine") {
        try {
            const target = interaction.options.getUser("user", true);
            const durationText = interaction.options.getString("duration", true);
            const reason = interaction.options.getString("reason", true);
            const team = interaction.options.getString("team", true);

            const durationMs = ms(durationText);
            if (!durationMs || durationMs < 1000) {
                return interaction.reply({
                    content: "Invalid duration. Use something like `30m`, `2h`, `3d`.",
                    ephemeral: true,
                });
            }

            const guild = interaction.guild;
            const member = await guild.members.fetch(target.id).catch(() => null);

            if (!member) {
                return interaction.reply({
                    content: "That user is not in this server.",
                    ephemeral: true,
                });
            }

            const botMember = await guild.members.fetch(client.user.id);
            const quarantineRole = guild.roles.cache.get(QUARANTINE_ROLE_ID);
            const announceChannel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);

            if (!quarantineRole) {
                return interaction.reply({
                    content: "Quarantine role not found. Check QUARANTINE_ROLE_ID.",
                    ephemeral: true,
                });
            }

            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.reply({
                    content: "I need Manage Roles permission.",
                    ephemeral: true,
                });
            }

            if (quarantineRole.position >= botMember.roles.highest.position) {
                return interaction.reply({
                    content: "My role must be above the Quarantine role in the role list.",
                    ephemeral: true,
                });
            }

            if (member.roles.highest.position >= botMember.roles.highest.position) {
                return interaction.reply({
                    content: "I cannot manage this user because their top role is higher than mine.",
                    ephemeral: true,
                });
            }

            if (member.roles.cache.has(QUARANTINE_ROLE_ID)) {
                return interaction.reply({
                    content: "This user already has the Quarantine role.",
                    ephemeral: true,
                });
            }

            const expiresAt = Date.now() + durationMs;

            await member.roles.add(quarantineRole, reason).catch((err) => {
                throw err;
            });

            await savePunishment({
                guildId: guild.id,
                userId: member.id,
                roleId: QUARANTINE_ROLE_ID,
                announceChannelId: ANNOUNCE_CHANNEL_ID,
                moderatorId: interaction.user.id,
                reason,
                durationText,
                expiresAt,
            });

            if (announceChannel && announceChannel.isTextBased()) {
                const banEmbed = makeBanEmbed(
                    member,
                    durationText,
                    reason,
                    team,
                    `${interaction.user.tag} (<@${interaction.user.id}>)`,
                    expiresAt
                );
                //await announceChannel.send({ embeds: [banEmbed] }).catch(() => null);
                try {
                    await announceChannel.send({ embeds: [banEmbed] });
                    console.log(" Ban embed sent successfully.");
                } catch (err) {
                    console.error(" Failed to send embed:", err);
                }
            }

            return interaction.reply({
                content: `Quarantine applied to ${member.user.tag} for ${durationText}.`,
                ephemeral: true,
            });
        } catch (error) {
            console.error(error);
            return interaction.reply({
                content: "Something went wrong while applying quarantine.",
                ephemeral: true,
            }).catch(() => null);
        }
    }
});

client.login(TOKEN);
