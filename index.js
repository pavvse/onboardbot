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

async function verifyReferralCode(code) {
    const referrals = await fetchReferrals();

    if (!referrals) {
        return { success: false, error: 'Failed to fetch referral data' };
    }

    const referralList = extractReferralList(referrals);

    if (referralList.length === 0) {
        return { success: false, error: 'No referrals found in API response' };
    }

    const match = referralList.find(ref => ref.referralCode === code);

    if (match) {
        return { success: true, user: match };
    }

    return { success: false, error: 'Referral code not found' };
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('verify')
            .setDescription('Verify your referral code to get academy access')
            .addStringOption(option =>
                option.setName('code')
                    .setDescription('Your referral code')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('check-referrals')
            .setDescription('Check all referrals (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-verify')
            .setDescription('Send the verification embed to this channel (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

            const codeInput = new TextInputBuilder()
                .setCustomId('referral_code')
                .setLabel('Enter your referral code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. ABC123XY')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(20);

            const actionRow = new ActionRowBuilder().addComponents(codeInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
            return;
        }
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'verify_modal') {
            await interaction.deferReply({ ephemeral: true });

            const code = interaction.fields.getTextInputValue('referral_code').trim().toUpperCase();
            const result = await verifyReferralCode(code);

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
                    content: `**Verification failed.**\nThe referral code \`${code}\` was not found. Please check your code and try again.`
                });
            }
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'verify') {
        await interaction.deferReply({ ephemeral: true });

        const code = interaction.options.getString('code');
        const result = await verifyReferralCode(code);

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
                'Welcome! To gain access to the academy, you must verify your referral code.\n\n' +
                '**How to verify:**\n' +
                '1. Click the button below\n' +
                '2. Enter your referral code\n' +
                '3. Get instant access!\n\n' +
                '*Your referral code was provided when you signed up.*'
            )
            .setThumbnail('https://pbs.twimg.com/profile_images/1993457185062273024/-4D7BHKI_400x400.jpg')
            .setFooter({ text: 'Dark Academy' })
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId('verify_button')
            .setLabel('Verify Referral Code')
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
});

client.login(process.env.DISCORD_TOKEN);
