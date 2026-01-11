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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const COINWAVE_API_BASE = 'https://api.coinwave.gg/admin-internals/affiliates/VONDRAKEN';
const PAGE_SIZE = 100;

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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

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
                const roleId = process.env.VERIFIED_ROLE_ID;

                if (roleId) {
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        await member.roles.add(roleId);
                        console.log(`[ROLE] Assigned verified role to ${interaction.user.tag}`);

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
            const roleId = process.env.VERIFIED_ROLE_ID;

            if (roleId) {
                try {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    await member.roles.add(roleId);
                    console.log(`[ROLE] Assigned verified role to ${interaction.user.tag}`);

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
});

client.login(process.env.DISCORD_TOKEN);
