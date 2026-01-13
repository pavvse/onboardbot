require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { Pool } = require('pg');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const COINWAVE_API_BASE = 'https://api.coinwave.gg/admin-internals/affiliates/VONDRAKEN';
const PAGE_SIZE = 100;

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE
});

// Initialize database table
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_progress (
                user_id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255),
                current_lesson INTEGER DEFAULT 1,
                completed_lessons INTEGER[] DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] Database initialized successfully');
    } catch (error) {
        console.error('[DB] Error initializing database:', error);
    }
}

// Get user progress from database
async function getUserProgress(userId, username) {
    try {
        const result = await pool.query(
            'SELECT current_lesson, completed_lessons FROM user_progress WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            // Create new user entry
            await pool.query(
                'INSERT INTO user_progress (user_id, username, current_lesson) VALUES ($1, $2, 1)',
                [userId, username]
            );
            console.log(`[DB] New user inserted: ${username} (${userId}) - Starting at lesson 1`);
            return { currentLesson: 1, completedLessons: [] };
        }
        console.log(`[DB] User loaded: ${username} (${userId}) - Lesson ${result.rows[0].current_lesson}, Completed: ${result.rows[0].completed_lessons?.length || 0}`);
        return {
            currentLesson: result.rows[0].current_lesson,
            completedLessons: result.rows[0].completed_lessons || []
        };
    } catch (error) {
        console.error('[DB] Error getting user progress:', error);
        return { currentLesson: 1, completedLessons: [] };
    }
}

// Update user progress in database
async function updateUserProgress(userId, username, currentLesson, completedLessons = null) {
    try {
        if (completedLessons !== null) {
            await pool.query(
                `UPDATE user_progress
                 SET current_lesson = $1, completed_lessons = $2, username = $3, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $4`,
                [currentLesson, completedLessons, username, userId]
            );
            console.log(`[DB] Progress updated: ${username} (${userId}) - Lesson ${currentLesson}, Completed lessons: [${completedLessons.join(', ')}]`);
        } else {
            await pool.query(
                `UPDATE user_progress
                 SET current_lesson = $1, username = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $3`,
                [currentLesson, username, userId]
            );
            console.log(`[DB] Progress updated: ${username} (${userId}) - Now on lesson ${currentLesson}`);
        }
    } catch (error) {
        console.error('[DB] Error updating user progress:', error);
    }
}

// Lesson data
const LESSONS = [
    {
        id: 1,
        title: 'Understanding how to setup wallets and how to launch on CoinWave',
        video: 'COINWAVE.GG WEB BUNDLER TRAINING WITH A NEW TEACHER! - W4RR3N aka Warren Guru (720p, h264, youtube).mp4'
    }
    // Add more lessons here as needed
];

async function fetchAffiliatesPage(page = 1) {
    const url = `${COINWAVE_API_BASE}?page=${page}&pageSize=${PAGE_SIZE}`;
    console.log(`[API] Fetching page ${page}: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'Cookie': process.env.COINWAVE_COOKIE,
                'Accept': 'application/json'
            }
        });

        console.log(`[API] Response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[API] Error response body: ${errorText}`);
            throw new Error(`API returned ${response.status}`);
        }

        const json = await response.json();
        console.log(`[API] Response keys: ${Object.keys(json).join(', ')}`);
        console.log(`[API] Raw response preview: ${JSON.stringify(json).substring(0, 500)}`);

        return json;
    } catch (error) {
        console.error(`[API] Error fetching affiliates page ${page}:`, error);
        return null;
    }
}

async function fetchAllAffiliates() {
    console.log(`[FETCH_ALL] Starting to fetch all affiliates`);
    const allAffiliates = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const response = await fetchAffiliatesPage(page);

        if (!response) {
            console.log(`[FETCH_ALL] Failed to get page ${page}, stopping`);
            break;
        }

        const affiliates = response.data?.affiliates || response.affiliates || response.data || response;
        console.log(`[FETCH_ALL] Page ${page}: got ${Array.isArray(affiliates) ? affiliates.length : 0} affiliates`);

        if (Array.isArray(affiliates) && affiliates.length > 0) {
            allAffiliates.push(...affiliates);

            // Check if there are more pages
            const total = response.data?.total || response.data?.totalCount || response.total || response.totalCount;
            if (total) {
                hasMore = allAffiliates.length < total;
            } else {
                hasMore = affiliates.length === PAGE_SIZE;
            }
            page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`[FETCH_ALL] Completed - total affiliates: ${allAffiliates.length}`);
    return allAffiliates;
}

async function findAffiliateByUsername(username) {
    console.log(`[SEARCH] Looking for username: "${username}"`);
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const response = await fetchAffiliatesPage(page);

        if (!response) {
            console.log(`[SEARCH] Failed to get response for page ${page}`);
            return { found: false, error: 'Failed to fetch affiliate data' };
        }

        const affiliates = response.data?.affiliates || response.affiliates || response.data || response;
        console.log(`[SEARCH] Page ${page} - Is array: ${Array.isArray(affiliates)}, Length: ${Array.isArray(affiliates) ? affiliates.length : 'N/A'}`);

        if (!Array.isArray(affiliates)) {
            console.log(`[SEARCH] Invalid response format. Type: ${typeof affiliates}`);
            return { found: false, error: 'Invalid API response format' };
        }

        // Log first few affiliates to see the data structure
        if (affiliates.length > 0) {
            console.log(`[SEARCH] Sample affiliate object keys: ${Object.keys(affiliates[0]).join(', ')}`);
            const sampleNames = affiliates.slice(0, 5).map(a => a.username || a.name || a.user?.username || a.user?.name || 'UNKNOWN');
            console.log(`[SEARCH] First 5 usernames on page ${page}: ${sampleNames.join(', ')}`);
        }

        // Search for the username in this page
        const match = affiliates.find(affiliate => {
            const name = affiliate.username || affiliate.name || affiliate.user?.username || affiliate.user?.name || '';
            return name.toLowerCase() === username.toLowerCase();
        });

        if (match) {
            console.log(`[SEARCH] Found match on page ${page}:`, JSON.stringify(match).substring(0, 300));
            return { found: true, user: match };
        }

        // Check if there are more pages
        const total = response.data?.total || response.data?.totalCount || response.total || response.totalCount;
        console.log(`[SEARCH] Page ${page} - Total from response: ${total}, Current count: ${affiliates.length}`);

        if (total) {
            hasMore = page * PAGE_SIZE < total;
        } else {
            hasMore = affiliates.length === PAGE_SIZE;
        }
        console.log(`[SEARCH] Has more pages: ${hasMore}`);
        page++;
    }

    console.log(`[SEARCH] Username "${username}" not found after searching all pages`);
    return { found: false, error: 'Username not found' };
}

async function verifyUsername(username) {
    console.log(`[VERIFY] Starting verification for: "${username}"`);
    const result = await findAffiliateByUsername(username);

    if (result.found) {
        console.log(`[VERIFY] Success - User found: ${result.user?.username || result.user?.name || 'unknown'}`);
        return { success: true, user: result.user };
    }

    console.log(`[VERIFY] Failed - ${result.error}`);
    return { success: false, error: result.error || 'Username not found' };
}

// Guild-specific role configuration
const GUILD_ROLES = {
    '1332146437932318830': '1353794092018040832', // Coinwave
    '1425507172040577147': '1449518242572795945'  // Dark FnF
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Initialize database
    await initDatabase();

    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('verify')
            .setDescription('Verify your Coinwave username to get academy access')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('Your Coinwave username')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('check-referrals')
            .setDescription('Check all referrals (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-verify')
            .setDescription('Send the verification embed to this channel (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('send-referral-note')
            .setDescription('Send the referral code note as a reply to a message (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('message_id')
                    .setDescription('The message ID to reply to')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('dev-tools')
            .setDescription('Send the developer tools resource embed (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-review')
            .setDescription('Send the launch review channel intro embed (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-lessons')
            .setDescription('Send the lessons/training hub embed (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('announce')
            .setDescription('Send a message as the bot (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('The message content')
                    .setRequired(false)
            )
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send to (defaults to current channel)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('image')
                    .setDescription('Image URL to include')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('Embed title')
                    .setRequired(false)
            )
            .addBooleanOption(option =>
                option.setName('allow_pings')
                    .setDescription('Allow @everyone and @here pings (default: false)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('Embed color in hex (e.g. FF0000 for red)')
                    .setRequired(false)
            )
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash commands registered!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    // Handle button clicks
    if (interaction.isButton()) {
        if (interaction.customId === 'start_learning') {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const progress = await getUserProgress(userId, username);
            const currentLesson = progress.currentLesson;
            const lesson = LESSONS.find(l => l.id === currentLesson) || LESSONS[0];

            const lessonEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: 'Dark Academy',
                    iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
                })
                .setTitle(`Lesson ${lesson.id}: ${lesson.title}`)
                .setDescription(
                    `**Tip:** Open this in another tab so you can keep using Discord normally without interruption.\n\n` +
                    `**Progress:** Lesson ${lesson.id} of ${LESSONS.length}\n` +
                    `**Completed:** ${progress.completedLessons ? progress.completedLessons.length : 0}/${LESSONS.length} lessons`
                )
                .setFooter({ text: 'Dark Academy • Learn & Level Up' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_lesson')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(currentLesson === 1),
                new ButtonBuilder()
                    .setCustomId('mark_complete')
                    .setLabel('Mark Complete')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_lesson')
                    .setLabel('Next Lesson')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(currentLesson >= LESSONS.length)
            );

            // Send video file with embed
            const path = require('path');
            const videoPath = path.join(__dirname, lesson.video);

            try {
                await interaction.editReply({
                    files: [{ attachment: videoPath, name: lesson.video }],
                    embeds: [lessonEmbed],
                    components: [row]
                });
            } catch (error) {
                console.error('Error sending lesson:', error);
                await interaction.editReply({
                    content: 'Failed to load lesson video. Please contact an admin.'
                });
            }
            return;
        }

        if (interaction.customId === 'mark_complete') {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const progress = await getUserProgress(userId, username);
            const currentLesson = progress.currentLesson;
            let completedLessons = progress.completedLessons || [];

            // Add current lesson to completed if not already there
            if (!completedLessons.includes(currentLesson)) {
                completedLessons.push(currentLesson);
            }

            // Move to next lesson if available
            const nextLesson = currentLesson < LESSONS.length ? currentLesson + 1 : currentLesson;
            await updateUserProgress(userId, username, nextLesson, completedLessons);

            // Show updated lesson with new progress
            const lesson = LESSONS.find(l => l.id === nextLesson) || LESSONS[LESSONS.length - 1];

            const lessonEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: 'Dark Academy',
                    iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
                })
                .setTitle(`Lesson ${lesson.id}: ${lesson.title}`)
                .setDescription(
                    `✅ **Lesson ${currentLesson} marked as complete!**\n\n` +
                    `**Tip:** Open this in another tab so you can keep using Discord normally without interruption.\n\n` +
                    `**Progress:** Lesson ${lesson.id} of ${LESSONS.length}\n` +
                    `**Completed:** ${completedLessons.length}/${LESSONS.length} lessons`
                )
                .setFooter({ text: 'Dark Academy • Learn & Level Up' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_lesson')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(nextLesson === 1),
                new ButtonBuilder()
                    .setCustomId('mark_complete')
                    .setLabel('Mark Complete')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_lesson')
                    .setLabel('Next Lesson')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(nextLesson >= LESSONS.length)
            );

            const path = require('path');
            const videoPath = path.join(__dirname, lesson.video);

            try {
                await interaction.editReply({
                    files: [{ attachment: videoPath, name: lesson.video }],
                    embeds: [lessonEmbed],
                    components: [row]
                });
            } catch (error) {
                console.error('Error sending lesson:', error);
                await interaction.editReply({
                    content: `✅ **Lesson ${currentLesson} marked as complete!** (${completedLessons.length}/${LESSONS.length} completed)\n\n${currentLesson < LESSONS.length ? 'Click "Start Learning" to continue to the next lesson.' : 'You\'ve completed all lessons!'}`
                });
            }
            return;
        }

        if (interaction.customId === 'next_lesson') {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const progress = await getUserProgress(userId, username);
            const currentLesson = progress.currentLesson;
            const nextLessonNum = Math.min(currentLesson + 1, LESSONS.length);
            await updateUserProgress(userId, username, nextLessonNum);

            const lesson = LESSONS.find(l => l.id === nextLessonNum) || LESSONS[LESSONS.length - 1];
            const completedCount = progress.completedLessons ? progress.completedLessons.length : 0;
            console.log(`[LESSON] next_lesson: User ${username} now on lesson ${nextLessonNum}, completed: ${completedCount}`);

            const lessonEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: 'Dark Academy',
                    iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
                })
                .setTitle(`Lesson ${lesson.id}: ${lesson.title}`)
                .setDescription(
                    `**Tip:** Open this in another tab so you can keep using Discord normally without interruption.\n\n` +
                    `**Progress:** Lesson ${lesson.id} of ${LESSONS.length}\n` +
                    `**Completed:** ${completedCount}/${LESSONS.length} lessons`
                )
                .setFooter({ text: 'Dark Academy • Learn & Level Up' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_lesson')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(nextLessonNum === 1),
                new ButtonBuilder()
                    .setCustomId('mark_complete')
                    .setLabel('Mark Complete')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_lesson')
                    .setLabel('Next Lesson')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(nextLessonNum >= LESSONS.length)
            );

            const path = require('path');
            const videoPath = path.join(__dirname, lesson.video);

            try {
                await interaction.editReply({
                    files: [{ attachment: videoPath, name: lesson.video }],
                    embeds: [lessonEmbed],
                    components: [row]
                });
            } catch (error) {
                console.error('Error sending lesson:', error);
                await interaction.editReply({
                    content: 'Failed to load lesson video. Please contact an admin.'
                });
            }
            return;
        }

        if (interaction.customId === 'prev_lesson') {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const username = interaction.user.tag;
            const progress = await getUserProgress(userId, username);
            const currentLesson = progress.currentLesson;
            const prevLessonNum = Math.max(currentLesson - 1, 1);
            await updateUserProgress(userId, username, prevLessonNum);

            const lesson = LESSONS.find(l => l.id === prevLessonNum) || LESSONS[0];
            const completedCount = progress.completedLessons ? progress.completedLessons.length : 0;
            console.log(`[LESSON] prev_lesson: User ${username} now on lesson ${prevLessonNum}, completed: ${completedCount}`);

            const lessonEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: 'Dark Academy',
                    iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
                })
                .setTitle(`Lesson ${lesson.id}: ${lesson.title}`)
                .setDescription(
                    `**Tip:** Open this in another tab so you can keep using Discord normally without interruption.\n\n` +
                    `**Progress:** Lesson ${lesson.id} of ${LESSONS.length}\n` +
                    `**Completed:** ${completedCount}/${LESSONS.length} lessons`
                )
                .setFooter({ text: 'Dark Academy • Learn & Level Up' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_lesson')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(prevLessonNum === 1),
                new ButtonBuilder()
                    .setCustomId('mark_complete')
                    .setLabel('Mark Complete')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_lesson')
                    .setLabel('Next Lesson')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(prevLessonNum >= LESSONS.length)
            );

            const path = require('path');
            const videoPath = path.join(__dirname, lesson.video);

            try {
                await interaction.editReply({
                    files: [{ attachment: videoPath, name: lesson.video }],
                    embeds: [lessonEmbed],
                    components: [row]
                });
            } catch (error) {
                console.error('Error sending lesson:', error);
                await interaction.editReply({
                    content: 'Failed to load lesson video. Please contact an admin.'
                });
            }
            return;
        }

        if (interaction.customId === 'practice_test') {
            await interaction.reply({
                content: '🚧 **Practice Tests coming soon!** Stay tuned.',
                ephemeral: true
            });
            return;
        }

        if (interaction.customId === 'verify_button') {
            console.log(`[ACTION] User ${interaction.user.tag} (${interaction.user.id}) clicked verify button`);
            const modal = new ModalBuilder()
                .setCustomId('verify_modal')
                .setTitle('Dark Academy Verification');

            const usernameInput = new TextInputBuilder()
                .setCustomId('coinwave_username')
                .setLabel('Enter your Coinwave username')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. zonsol')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(30);

            const actionRow = new ActionRowBuilder().addComponents(usernameInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
            return;
        }
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'verify_modal') {
            await interaction.deferReply({ ephemeral: true });

            const username = interaction.fields.getTextInputValue('coinwave_username').trim();
            console.log(`[ACTION] User ${interaction.user.tag} (${interaction.user.id}) submitted verification for username: "${username}"`);
            const result = await verifyUsername(username);

            if (result.success) {
                console.log(`[RESULT] Modal verification SUCCESS for ${interaction.user.tag} - matched username: "${username}"`);
                const roleId = GUILD_ROLES[interaction.guild.id];

                if (roleId) {
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        await member.roles.add(roleId);
                        console.log(`[ROLE] Assigned verified role ${roleId} to ${interaction.user.tag} in guild ${interaction.guild.name}`);

                        await interaction.editReply({
                            content: `**Referral code verified!**\nWelcome to Dark Academy, ${result.user.name || result.user.username || 'member'}!`
                        });
                    } catch (error) {
                        console.error(`[ROLE] Error assigning role to ${interaction.user.tag}:`, error);
                        await interaction.editReply({
                            content: `**Referral code verified!**\nHowever, I couldn't assign your role. Please contact an admin.`
                        });
                    }
                } else {
                    console.log(`[ROLE] No role configured for guild ${interaction.guild.id}`);
                    await interaction.editReply({
                        content: `**Referral code verified!**\nWelcome, ${result.user.name || result.user.username || 'member'}!`
                    });
                }
            } else {
                console.log(`[RESULT] Modal verification FAILED for ${interaction.user.tag} - username: "${username}" - reason: ${result.error}`);
                await interaction.editReply({
                    content: `**Verification failed.**\nThe username \`${username}\` was not found. Make sure you used the referral code VONDRAKEN when signing up.`
                });
            }
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'verify') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString('username');
        console.log(`[ACTION] User ${interaction.user.tag} (${interaction.user.id}) used /verify command for username: "${username}"`);
        const result = await verifyUsername(username);

        if (result.success) {
            console.log(`[RESULT] Command verification SUCCESS for ${interaction.user.tag} - matched username: "${username}"`);
            const roleId = GUILD_ROLES[interaction.guild.id];

            if (roleId) {
                try {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    await member.roles.add(roleId);
                    console.log(`[ROLE] Assigned verified role ${roleId} to ${interaction.user.tag} in guild ${interaction.guild.name}`);

                    await interaction.editReply({
                        content: `**Referral code verified!**\nWelcome to Dark Academy!`
                    });
                } catch (error) {
                    console.error(`[ROLE] Error assigning role to ${interaction.user.tag}:`, error);
                    await interaction.editReply({
                        content: `**Referral code verified!**\nHowever, I couldn't assign your role. Please contact an admin.`
                    });
                }
            } else {
                console.log(`[ROLE] No role configured for guild ${interaction.guild.id}`);
                await interaction.editReply({
                    content: `**Referral code verified!**\nWelcome to Dark Academy!`
                });
            }
        } else {
            console.log(`[RESULT] Command verification FAILED for ${interaction.user.tag} - username: "${username}" - reason: ${result.error}`);
            await interaction.editReply({
                content: `**Verification failed.**\n${result.error}`
            });
        }
    }

    if (interaction.commandName === 'check-referrals') {
        console.log(`[ACTION] Admin ${interaction.user.tag} used /check-referrals command`);
        await interaction.deferReply({ ephemeral: true });

        const affiliates = await fetchAllAffiliates();
        console.log(`[CHECK] Fetched ${affiliates?.length || 0} total affiliates`);

        if (!affiliates || affiliates.length === 0) {
            await interaction.editReply({
                content: '📋 No affiliates found.'
            });
            return;
        }

        const affiliateInfo = affiliates.slice(0, 20).map((affiliate, i) => {
            const code = affiliate.referralCode || affiliate.code || 'N/A';
            const name = affiliate.username || affiliate.name || affiliate.email || '';
            return `${i + 1}. Code: \`${code}\` ${name ? `- ${name}` : ''}`;
        }).join('\n');

        await interaction.editReply({
            content: `**Affiliates (${affiliates.length} total):**\n${affiliateInfo}${affiliates.length > 20 ? '\n... and more' : ''}`
        });
    }

    if (interaction.commandName === 'setup-verify') {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name: 'Dark Academy',
                iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
            })
            .setTitle('Academy Enrollment')
            .setDescription(
                'Welcome! To gain access to the academy, you must verify your Coinwave username.\n\n' +
                '**How to verify:**\n' +
                '1. Click the button below\n' +
                '2. Enter your Coinwave username\n' +
                '3. Get instant access!\n\n' +
                '*Make sure you signed up using the referral code* `VONDRAKEN`'
            )
            .setThumbnail('https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg')
            .setFooter({ text: 'Dark Academy' })
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId('verify_button')
            .setLabel('Verify Username')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(button);

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({
            content: 'Verification embed has been sent!',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'send-referral-note') {
        const messageId = interaction.options.getString('message_id');

        try {
            const message = await interaction.channel.messages.fetch(messageId);

            const noteEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: 'Dark Academy',
                    iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
                })
                .setDescription(
                    '**To gain access to the academy, you must use the referral code:**\n\n' +
                    '`VONDRAKEN`\n\n' +
                    'Sign up here: https://join.coinwave.gg/VONDRAKEN'
                );

            await message.reply({ embeds: [noteEmbed] });

            await interaction.reply({
                content: 'Referral note sent!',
                ephemeral: true
            });
        } catch (error) {
            console.error('Error sending note:', error);
            await interaction.reply({
                content: 'Failed to send note. Make sure the message ID is correct and in this channel.',
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === 'dev-tools') {
        const embed = new EmbedBuilder()
            .setColor(0x9945FF)
            .setAuthor({
                name: 'Dark Academy',
                iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
            })
            .setTitle('Developer Toolkit')
            .setDescription(
                'Essential resources to help you design, build, and launch your token successfully.\n\u200B'
            )
            .addFields(
                {
                    name: '🎨 AI Design Tools',
                    value:
                        '> Create logos, banners, and marketing assets\n' +
                        '> [Recraft AI](https://www.recraft.ai/) - Design & illustration generator\n' +
                        '> [Leonardo AI](https://leonardo.ai/) - AI image generation for branding\n\u200B',
                    inline: false
                },
                {
                    name: '🌐 Website Builders',
                    value:
                        '> Launch a professional site with zero coding\n' +
                        '> [Bolt](https://bolt.new/) - AI-powered site generator\n' +
                        '> [V0.dev](https://v0.dev/) - AI UI component builder\n' +
                        '> [Cursor](https://cursor.sh/) - AI coding environment\n' +
                        '> [Framer](https://www.framer.com/) - No-code website builder\n\u200B',
                    inline: false
                },
                {
                    name: '🔒 Privacy Tools',
                    value:
                        '> Protect your creator wallet from snipers\n' +
                        '> [SideShift](https://sideshift.ai/) - Instant crypto swap (enable Monero mode for extra privacy)\n' +
                        '> [ChangeNOW](https://changenow.io/) - No-registration exchange\n' +
                        '> [FixedFloat](https://fixedfloat.com/) - Anonymous instant swaps',
                    inline: false
                }
            )
            .setFooter({ text: 'Dark Academy • Build Smart' })
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });

        await interaction.reply({
            content: 'Developer tools embed sent!',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'setup-lessons') {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name: 'Dark Academy',
                iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
            })
            .setTitle('Welcome to the Dark Academy Developer Vault')
            .setDescription(
                '*This isn\'t a tutorial. It\'s the system they didn\'t want you to find.*\n\n' +
                'Inside are **battle-tested dev lessons** — designed to transform how you launch, scale, and profit.\n' +
                'Along with the Lessons, you unlock the **Dev Masterclass Series** — a complete breakdown of every **launch method**, **volume strategy**, and **profit framework** that separates winners from the rest.\n\n' +
                '————————————\n\n' +
                '🎁 **What\'s Inside:**\n' +
                '• Step-by-step video lessons — unlocked as you progress\n' +
                '• Practice tests to **sharpen your knowledge after each module**\n' +
                '• The complete **Dev Playbook** — strategies the top devs don\'t share\n' +
                '• Progress tracking so you **never lose your place**\n' +
                '• Easy navigation — **learn at your own speed**\n' +
                '• Built to **turn mistakes into lessons, and lessons into profits**\n\n' +
                '————————————\n\n' +
                '🧠 *Anyone can launch. Few know how to print.*\n' +
                '**The Vault doesn\'t just teach you to dev. It builds you to dominate.**\n\n' +
                '*Unlock it. Learn in silence. Launch loud.*'
            )
            .setFooter({ text: 'Dark Academy' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_learning')
                .setLabel('Start Learning')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📚'),
            new ButtonBuilder()
                .setCustomId('practice_test')
                .setLabel('Practice Test')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📝')
        );

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({
            content: 'Training hub embed sent!',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'setup-review') {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name: 'Dark Academy',
                iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
            })
            .setTitle('Launch Review')
            .setDescription(
                'Drop a **Contract Address (CA)** below and one of our educators will review your launch.\n\n' +
                'We\'ll break down what went wrong, what you did right, and how to improve your next one.\n\n' +
                '*Learning from your launches is the fastest way to level up.*'
            )
            .setFooter({ text: 'Dark Academy' })
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });

        await interaction.reply({
            content: 'Review channel intro sent!',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'announce') {
        const message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const imageUrl = interaction.options.getString('image');
        const title = interaction.options.getString('title');
        const allowPings = interaction.options.getBoolean('allow_pings') ?? false;
        const colorHex = interaction.options.getString('color');

        if (!message && !imageUrl && !title) {
            await interaction.reply({
                content: 'You must provide at least a message, title, or image.',
                ephemeral: true
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(colorHex ? parseInt(colorHex, 16) : 0x000000)
            .setAuthor({
                name: 'Dark Academy',
                iconURL: 'https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg'
            })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (message) embed.setDescription(message);
        if (imageUrl) embed.setImage(imageUrl);

        try {
            const sendOptions = { embeds: [embed] };

            if (!allowPings) {
                sendOptions.allowedMentions = { parse: [] };
            }

            await targetChannel.send(sendOptions);

            await interaction.reply({
                content: `Message sent to <#${targetChannel.id}>!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error sending announcement:', error);
            await interaction.reply({
                content: 'Failed to send message. Make sure the bot has permissions in that channel.',
                ephemeral: true
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
