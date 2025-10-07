console.log("🔍 Bot en ejecución...");

const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");

// --- Base de datos sqlite3 ---
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./ratings.db");
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playerId TEXT,
        raterId TEXT,
        shot INTEGER,
        assist INTEGER,
        defense INTEGER,
        goalkeeping INTEGER,
        comment TEXT,
        timestamp INTEGER
    )`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// --- Datos del equipo por servidor ---
let teamPositions = {}; // { guildId: { CF:..., LW:..., ... } }
let playerStyles = {};  // { guildId: { userId: style } }
let playerNames = {};   // { guildId: { userId: name } }

const styleCharacters = {
    rare: ["Isagi", "Igaguri", "Hiori", "Chigiri"],
    epic: ["Kurona", "Gagamaru", "Bachira"],
    legendary: ["Otoya", "Nagi", "Karasu"],
    mythic: ["Shidou", "Yukimiya", "NEL Bachira", "King", "NEL Reo", "Aiku", "Kunigami"],
    world_class: ["Charles", "NEL Isagi", "NEL Nagi", "NEL Rin"],
    generational: ["Sae", "Bunny", "Kaiser", "Don Lorenzo"],
    master: ["Lavinho", "Loki"]
};

// --- Función para crear embed del equipo ---
const createTeamEmbed = (guildId) => {
    const positions = teamPositions[guildId] || { CF: null, LW: null, RW: null, CM: null, GK: null };
    const styles = playerStyles[guildId] || {};
    const names = playerNames[guildId] || {};

    const desc = Object.entries(positions)
        .map(([pos, id]) => {
            if (!id) return `**${pos}** : Vacío (No elegido)`;
            const style = styles[id] ? styles[id].toUpperCase() : "No elegido";
            const name = names[id] ? names[id] : null;
            return `**${pos}** : <@${id}> (${style}${name ? " - " + name : ""})`;
        })
        .join("\n");

    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚽ Equipo principal")
        .setDescription(desc)
        .setFooter({ text: "Elige tu posición o califica/ver jugadores abajo" });
};

const positionMenu = new StringSelectMenuBuilder()
    .setCustomId("position_select")
    .setPlaceholder("Elige tu posición...")
    .addOptions([
        { label: "CF", value: "CF" },
        { label: "LW", value: "LW" },
        { label: "RW", value: "RW" },
        { label: "CM", value: "CM" },
        { label: "GK", value: "GK" }
    ]);

const leaveButton = new ButtonBuilder()
    .setCustomId("leave_position")
    .setLabel("Leave Position")
    .setStyle(ButtonStyle.Danger);

const removeButton = new ButtonBuilder()
    .setCustomId("remove_player")
    .setLabel("Eliminar jugador")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🗑️");

const mainRateOrViewButton = new ButtonBuilder()
    .setCustomId("main_rate_or_view")
    .setLabel("📋 Calificar o Ver jugador")
    .setStyle(ButtonStyle.Primary);

client.once("ready", () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.content === "!amis") {
        const guildId = message.guild.id;
        teamPositions[guildId] = { CF: null, LW: null, RW: null, CM: null, GK: null };
        playerStyles[guildId] = {};
        playerNames[guildId] = {};

        const embed = createTeamEmbed(guildId);
        const row1 = new ActionRowBuilder().addComponents(positionMenu);
        const row2 = new ActionRowBuilder().addComponents(leaveButton, removeButton, mainRateOrViewButton);
        await message.channel.send({
            content: "♻️ **Se ha reiniciado el equipo anterior.**",
            embeds: [embed],
            components: [row1, row2]
        });
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;
    const guildId = interaction.guild.id;

    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    // 🗑️ Eliminar jugador (con permiso)
    if (interaction.customId === "remove_player") {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!member.permissions.has(PermissionFlagsBits.MentionEveryone)) {
            return interaction.reply({
                content: "🚫 No tienes el permiso **'Mencionar @everyone'**, por lo tanto no puedes eliminar jugadores.",
                ephemeral: true
            });
        }

        const filledPositions = Object.entries(teamPositions[guildId] || {})
            .filter(([_, id]) => id)
            .map(([pos]) => ({ label: pos, value: pos }));

        if (filledPositions.length === 0) {
            return interaction.reply({
                content: "⚠️ No hay jugadores en ninguna posición para eliminar.",
                ephemeral: true
            });
        }

        const removeMenu = new StringSelectMenuBuilder()
            .setCustomId("remove_select")
            .setPlaceholder("Selecciona la posición a vaciar...")
            .addOptions(filledPositions);

        const row = new ActionRowBuilder().addComponents(removeMenu);

        await interaction.reply({
            content: "🗑️ Selecciona la posición del jugador que deseas eliminar:",
            components: [row],
            ephemeral: true
        });
    }

    // Confirmar eliminación
    if (interaction.customId === "remove_select") {
        const position = interaction.values[0];
        const removedUser = teamPositions[guildId][position];
        if (!removedUser)
            return interaction.reply({ content: "⚠️ Esa posición ya está vacía.", ephemeral: true });

        teamPositions[guildId][position] = null;
        playerStyles[guildId][removedUser] = null;
        playerNames[guildId][removedUser] = null;

        const embed = createTeamEmbed(guildId);
        const msgs = await interaction.channel.messages.fetch({ limit: 10 });
        const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        if (botMsg) await botMsg.edit({ embeds: [embed] });

        await interaction.reply({ content: `✅ Jugador eliminado de ${position}.`, ephemeral: true });
    }

    // 🎯 Elegir posición
    if (interaction.customId === "position_select") {
        const position = interaction.values[0];
        const user = interaction.user;

        if (teamPositions[guildId][position] && teamPositions[guildId][position] !== user.id) {
            return interaction.reply({
                content: `❌ La posición **${position}** ya está ocupada.`,
                ephemeral: true
            });
        }

        for (let pos in teamPositions[guildId]) {
            if (teamPositions[guildId][pos] === user.id) teamPositions[guildId][pos] = null;
        }

        teamPositions[guildId][position] = user.id;

        const embed = createTeamEmbed(guildId);
        await interaction.update({ embeds: [embed] });

        const styleMenu = new StringSelectMenuBuilder()
            .setCustomId("style_select")
            .setPlaceholder("Elige tu rareza...")
            .addOptions([
                { label: "Rare", value: "rare" },
                { label: "Epic", value: "epic" },
                { label: "Legendary", value: "legendary" },
                { label: "Mythic", value: "mythic" },
                { label: "World Class", value: "world_class" },
                { label: "Generational", value: "generational" },
                { label: "Master", value: "master" }
            ]);

        await interaction.followUp({
            content: "🌟 Ahora elige tu rareza:",
            components: [new ActionRowBuilder().addComponents(styleMenu)],
            ephemeral: true
        });
    }

    // 💎 Elegir rareza
    if (interaction.customId === "style_select") {
        const style = interaction.values[0];
        const user = interaction.user;
        playerStyles[guildId][user.id] = style;

        const characters = styleCharacters[style];
        if (characters?.length > 0) {
            const charMenu = new StringSelectMenuBuilder()
                .setCustomId("character_select")
                .setPlaceholder(`Elige tu jugador (${style.toUpperCase()})`)
                .addOptions(characters.map((c) => ({ label: c, value: c.toLowerCase() })));

            await interaction.reply({
                content: `🎯 Elegiste **${style.toUpperCase()}**. Ahora selecciona tu jugador:`,
                components: [new ActionRowBuilder().addComponents(charMenu)],
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: `✅ Elegiste estilo **${style.toUpperCase()}**.`,
                ephemeral: true
            });
        }
    }

    // 🧠 Elegir jugador
    if (interaction.customId === "character_select") {
        const player = interaction.values[0];
        const user = interaction.user;
        const style = playerStyles[guildId][user.id] || "Desconocido";
        playerNames[guildId][user.id] = player.charAt(0).toUpperCase() + player.slice(1);

        await interaction.reply({
            content: `✅ Has elegido **${playerNames[guildId][user.id]}** (${style.toUpperCase()})`,
            ephemeral: true
        });

        const embed = createTeamEmbed(guildId);
        const msgs = await interaction.channel.messages.fetch({ limit: 10 });
        const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        if (botMsg) await botMsg.edit({ embeds: [embed] });
    }

    // 🔴 Dejar posición
    if (interaction.customId === "leave_position") {
        const user = interaction.user;
        let removed = false;

        for (let pos in teamPositions[guildId]) {
            if (teamPositions[guildId][pos] === user.id) {
                teamPositions[guildId][pos] = null;
                playerStyles[guildId][user.id] = null;
                playerNames[guildId][user.id] = null;
                removed = true;
            }
        }

        if (!removed)
            return interaction.reply({
                content: "⚠️ No tienes ninguna posición asignada.",
                ephemeral: true
            });

        const embed = createTeamEmbed(guildId);
        await interaction.update({ embeds: [embed] });
    }

    // --- FLUJO NUEVO: 1 botón, primero jugador, luego acción ---
    if (interaction.customId === "main_rate_or_view") {
        const userId = interaction.user.id;
        const jugadores = Object.entries(teamPositions[guildId] || {})
            .filter(([_, id]) => id)
            .map(([pos, id]) => ({
                label: `${pos} - ${playerNames[guildId][id] || "Desconocido"}` + (id === userId ? " (Tú)" : ""),
                value: id
            }));

        if (jugadores.length === 0) {
            return interaction.reply({
                content: "⚠️ No hay jugadores para calificar o ver.",
                ephemeral: true
            });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId("choose_player_to_act")
            .setPlaceholder("Selecciona un jugador primero...")
            .addOptions(jugadores);

        await interaction.reply({
            content: "👤 ¿Sobre qué jugador quieres actuar?",
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true
        });
    }

    // --- Paso 2: Elegir si calificar o ver calificaciones ---
    if (interaction.customId === "choose_player_to_act") {
        const playerId = interaction.values[0];
        client.pendingAction = client.pendingAction || {};
        client.pendingAction[interaction.user.id] = playerId;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isSelf = playerId === interaction.user.id;
        let options = [
            { label: "Ver calificaciones", value: "view" }
        ];
        // Solo permitir calificar si NO eres tú mismo y tienes el permiso
        if (!isSelf && member.permissions.has(PermissionFlagsBits.MentionEveryone)) {
            options.unshift({ label: "Calificar", value: "rate" });
        }

        const actionMenu = new StringSelectMenuBuilder()
            .setCustomId("choose_action_type")
            .setPlaceholder("¿Qué deseas hacer?")
            .addOptions(options);

        await interaction.reply({
            content: `¿Qué deseas hacer con <@${playerId}>?`,
            components: [new ActionRowBuilder().addComponents(actionMenu)],
            ephemeral: true
        });
    }

    // --- Paso 3: Según elección, califica o muestra las calificaciones ---
    if (interaction.customId === "choose_action_type") {
        const action = interaction.values[0];
        const userId = interaction.user.id;
        const playerId = client.pendingAction?.[userId];
        if (!playerId) {
            return interaction.reply({
                content: "❌ Ocurrió un error interno (no se encontró el jugador elegido).",
                ephemeral: true
            });
        }
        client.lastPlayerAction = client.lastPlayerAction || {};
        client.lastPlayerAction[userId] = playerId;

        if (action === "rate") {
            db.get(
                `SELECT timestamp FROM ratings WHERE playerId = ? AND raterId = ? ORDER BY timestamp DESC LIMIT 1`,
                [playerId, userId],
                async (err, row) => {
                    if (err) {
                        await interaction.reply({
                            content: "❌ Error al consultar la base de datos.",
                            ephemeral: true
                        });
                        return;
                    }
                    const now = Math.floor(Date.now() / 1000);
                    if (row && now - row.timestamp < 600) {
                        const restante = Math.ceil((600 - (now - row.timestamp)) / 60);
                        await interaction.reply({
                            content: `⏳ Solo puedes calificar a <@${playerId}> una vez cada 10 minutos. Intenta de nuevo en ${restante} minutos.`,
                            ephemeral: true
                        });
                        return;
                    }
                    const createRatingMenu = (id, label) =>
                        new StringSelectMenuBuilder()
                            .setCustomId(id)
                            .setPlaceholder(`${label} (1 - 10)`)
                            .addOptions(
                                Array.from({ length: 10 }, (_, i) => ({
                                    label: `${i + 1}`,
                                    value: `${i + 1}`
                                }))
                            );

                    const rows = [
                        new ActionRowBuilder().addComponents(createRatingMenu("rate_shot", "Disparo")),
                        new ActionRowBuilder().addComponents(createRatingMenu("rate_assist", "Asistencias")),
                        new ActionRowBuilder().addComponents(createRatingMenu("rate_defense", "Defensa")),
                        new ActionRowBuilder().addComponents(createRatingMenu("rate_goalkeeping", "Portero"))
                    ];

                    client.tempRatings = client.tempRatings || {};
                    client.tempRatings[userId] = { playerId: playerId, stats: {} };

                    await interaction.reply({
                        content: `📊 Calificando a <@${playerId}> — selecciona tus puntuaciones:`,
                        components: rows,
                        ephemeral: true
                    });
                }
            );
        } else if (action === "view") {
            const name = playerNames[guildId][playerId] || "Desconocido";
            const pos = Object.entries(teamPositions[guildId]).find(([_, id]) => id === playerId)?.[0] || "";

            db.all(
                `SELECT * FROM ratings WHERE playerId = ?`,
                [playerId],
                async (err, rows) => {
                    if (err) {
                        await interaction.reply({
                            content: "❌ Error al consultar la base de datos.",
                            ephemeral: true
                        });
                        return;
                    }
                    if (!rows || rows.length === 0) {
                        await interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xf2c744)
                                    .setTitle(`⭐ Calificaciones de ${name} (${pos})`)
                                    .setDescription("No tiene calificaciones aún.")
                            ],
                            ephemeral: true
                        });
                        return;
                    }
                    const avg = { Disparo: 0, Asistencias: 0, Defensa: 0, Portero: 0 };
                    rows.forEach(r => {
                        avg.Disparo += Number(r.shot);
                        avg.Asistencias += Number(r.assist);
                        avg.Defensa += Number(r.defense);
                        avg.Portero += Number(r.goalkeeping);
                    });
                    for (const k in avg) avg[k] = (avg[k] / rows.length).toFixed(1);
                    const comentarios = rows.map(r => `> **${r.comment}** — <@${r.raterId}>`).join("\n");
                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xf2c744)
                                .setTitle(`⭐ Calificaciones de ${name} (${pos})`)
                                .setDescription(
                                    `Promedios:\nDisparo: **${avg.Disparo}**\nAsistencias: **${avg.Asistencias}**\nDefensa: **${avg.Defensa}**\nPortero: **${avg.Portero}**\n\n**Comentarios:**\n${comentarios}`
                                )
                        ],
                        ephemeral: true
                    });
                }
            );
        }
    }

    // --- Guardar calificaciones parciales (en la base de datos) ---
    const ratingFields = ["rate_shot", "rate_assist", "rate_defense", "rate_goalkeeping"];
    if (ratingFields.includes(interaction.customId)) {
        const rating = interaction.values[0];
        const uid = interaction.user.id;
        const temp = client.tempRatings?.[uid];
        if (!temp) return;

        const names = {
            rate_shot: "Disparo",
            rate_assist: "Asistencias",
            rate_defense: "Defensa",
            rate_goalkeeping: "Portero"
        };
        const field = names[interaction.customId];
        temp.stats[field] = rating;

        await interaction.reply({
            content: `✅ Guardado **${field}**: ${rating}/10`,
            ephemeral: true
        });

        if (Object.keys(temp.stats).length === 4) {
            await interaction.followUp({
                content: "💬 Escribe una breve descripción sobre el jugador (máx 200 caracteres):",
                ephemeral: true
            });

            const filter = m => m.author.id === uid;
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 });
            const comment = collected.first()?.content || "Sin comentario.";

            db.run(
                `INSERT INTO ratings (playerId, raterId, shot, assist, defense, goalkeeping, comment, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    temp.playerId,
                    uid,
                    Number(temp.stats["Disparo"]),
                    Number(temp.stats["Asistencias"]),
                    Number(temp.stats["Defensa"]),
                    Number(temp.stats["Portero"]),
                    comment,
                    Math.floor(Date.now() / 1000)
                ]
            );

            const e = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle("📋 Calificación completada")
                .setDescription(`Jugador: <@${temp.playerId}>`)
                .addFields(
                    { name: "Disparo 🎯", value: `${temp.stats["Disparo"]}/10`, inline: true },
                    { name: "Asistencias 🎯", value: `${temp.stats["Asistencias"]}/10`, inline: true },
                    { name: "Defensa 🛡️", value: `${temp.stats["Defensa"]}/10`, inline: true },
                    { name: "Portero 🧤", value: `${temp.stats["Portero"]}/10`, inline: true },
                    { name: "💬 Comentario", value: comment }
                )
                .setFooter({ text: "Solo visible para vos" });

            await interaction.followUp({ embeds: [e], ephemeral: true });
            delete client.tempRatings[uid];
            if (client.pendingAction) delete client.pendingAction[uid];
            if (client.lastPlayerAction) delete client.lastPlayerAction[uid];
        }
    }
});

client.login("MTQyNDgyMzk2NzU5NTYyNjU2Ng.GUn-nq.4RSyjcATDqlbUScIUNQwA1fz_hcNQT07efoYMk");