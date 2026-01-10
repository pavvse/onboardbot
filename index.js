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

const COINWAVE_API = 'https://api.coinwave.gg/users/me/referrals';

async function fetchReferrals() {
    try {
        const response = await fetch(COINWAVE_API, {
            headers: {
                'Cookie': process.env.COINWAVE_COOKIE,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching referrals:', error);
        return null;
    }
}

function extractReferralList(apiResponse) {
    if (!apiResponse || !apiResponse.data) return [];

    const allReferrals = [];

    // Recursively flatten nested referrals
    function flattenReferrals(referralArray) {
        if (!Array.isArray(referralArray)) return;

        for (const ref of referralArray) {
            if (ref.referralCode) {
                allReferrals.push(ref);
            }
            // Recursively process nested referrals
            if (ref.referrals && Array.isArray(ref.referrals)) {
                flattenReferrals(ref.referrals);
            }
        }
    }

    // Process directReferrals from the API response
    if (apiResponse.data.directReferrals) {
        flattenReferrals(apiResponse.data.directReferrals);
    }

    return allReferrals;
}

async function verifyUsername(username) {
    const referrals = await fetchReferrals();

    if (!referrals) {
        return { success: false, error: 'Failed to fetch referral data' };
    }

    const referralList = extractReferralList(referrals);

    if (referralList.length === 0) {
        return { success: false, error: 'No referrals found in API response' };
    }

    const match = referralList.find(ref =>
        ref.name && ref.name.toLowerCase() === username.toLowerCase()
    );

    if (match) {
        return { success: true, user: match };
    }

    return { success: false, error: 'Username not found' };
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
            const result = await verifyUsername(username);

            if (result.success) {
                const roleId = process.env.VERIFIED_ROLE_ID;

                if (roleId) {
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        await member.roles.add(roleId);

                        await interaction.editReply({
                            content: `**Referral code verified!**\nWelcome to Dark Academy, ${result.user.name || 'member'}!`
                        });
                    } catch (error) {
                        console.error('Error assigning role:', error);
                        await interaction.editReply({
                            content: `**Referral code verified!**\nHowever, I couldn't assign your role. Please contact an admin.`
                        });
                    }
                } else {
                    await interaction.editReply({
                        content: `**Referral code verified!**\nWelcome, ${result.user.name || 'member'}!`
                    });
                }
            } else {
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
        const result = await verifyUsername(username);

        if (result.success) {
            // Try to assign the verified role
            const roleId = process.env.VERIFIED_ROLE_ID;

            if (roleId) {
                try {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    await member.roles.add(roleId);

                    await interaction.editReply({
                        content: `**Referral code verified!**\nWelcome to Dark Academy!`
                    });
                } catch (error) {
                    console.error('Error assigning role:', error);
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
            await interaction.editReply({
                content: `**Verification failed.**\n${result.error}`
            });
        }
    }

    if (interaction.commandName === 'check-referrals') {
        await interaction.deferReply({ ephemeral: true });

        const referrals = await fetchReferrals();

        if (!referrals) {
            await interaction.editReply({
                content: '❌ Failed to fetch referral data from the API.'
            });
            return;
        }

        const referralList = extractReferralList(referrals);

        if (referralList.length === 0) {
            await interaction.editReply({
                content: '📋 No referrals found.'
            });
            return;
        }

        const referralInfo = referralList.slice(0, 20).map((ref, i) => {
            const code = ref.referralCode || ref.code || 'N/A';
            const name = ref.username || ref.name || ref.email || '';
            return `${i + 1}. Code: \`${code}\` ${name ? `- ${name}` : ''}`;
        }).join('\n');

        await interaction.editReply({
            content: `**Referrals (${referralList.length} total):**\n${referralInfo}${referralList.length > 20 ? '\n... and more' : ''}`
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
