/** Guild-only slash commands. All answers are private; the database resolves guild and membership. */
import { escapeDiscord } from './raid-service-core.js'
import { signupReadiness, readinessText, roleNeeds } from './raid-readiness.js'
import { rosterPages } from './discord-roster.js'

const SNOWFLAKE = /^\d{17,20}$/
const PAGE_SIZE = 5
const COMMANDS = {
  next: 'See the next raid, role needs, and your status',
  upcoming: 'Browse raids over the next four weeks',
  mine: 'See your signups, bench places, and roster confirmations',
  roster: 'List every name on the roster, bench, tentative list, and absence list',
  readiness: 'Officer report: role gaps and outstanding roster confirmations',
  help: 'Learn how to sign up and manage your raids',
}
export const RAID_COMMAND = {
  name: 'raid',
  type: 1,
  description: 'Your WhenToRaid raid hub',
  options: Object.entries(COMMANDS).map(([name, description]) => ({
    type: 1,
    name,
    description,
    ...(name === 'roster'
      ? {
          options: [
            {
              type: 4,
              name: 'raid',
              description: 'Raid number from /raid upcoming (defaults to the next raid)',
              min_value: 1,
              max_value: 50,
            },
            { type: 4, name: 'page', description: 'Continue the player lists', min_value: 1, max_value: 20 },
          ],
        }
      : ['upcoming', 'mine', 'readiness'].includes(name)
        ? {
            options: [
              { type: 4, name: 'page', description: 'Page of five raids', min_value: 1, max_value: 10 },
            ],
          }
        : {}),
  })),
}

/** Upsert just our command, preserving any unrelated application commands. */
export async function registerRaidCommand({ applicationId, serverId, botToken, fetchFn = fetch }) {
  if (!SNOWFLAKE.test(applicationId ?? '') || !SNOWFLAKE.test(serverId ?? '') || !botToken)
    throw new Error('The Discord bot is not configured. Add it to your server first.')
  const response = await fetchFn(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${serverId}/commands`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(RAID_COMMAND),
    },
  )
  if (!response.ok) {
    if (response.status === 429) throw new Error('Discord is rate limiting command setup. Try again shortly.')
    throw new Error('Discord could not enable /raid. Check the bot connection and try again.')
  }
  return { command: '/raid' }
}

/** No user/guild IDs are accepted as command options. Identity comes from the signed envelope. */
export function parseRaidCommand(interaction) {
  if (interaction.type !== 2 || interaction.data?.type !== 1 || interaction.data?.name !== 'raid') return null
  const user = interaction.member?.user?.id
  if (
    ![interaction.id, interaction.guild_id, interaction.channel_id, user].every((id) =>
      SNOWFLAKE.test(id ?? ''),
    )
  )
    return null
  const options = interaction.data.options
  if (!Array.isArray(options) || options.length !== 1) return null
  const command = options[0]
  if (command?.type !== 1 || !Object.hasOwn(COMMANDS, command.name)) return null
  const parameters = command.options ?? []
  if (!Array.isArray(parameters) || parameters.length > (command.name === 'roster' ? 2 : 1)) return null
  let page = 1,
    raid = 1
  const seen = new Set()
  for (const option of parameters) {
    const isRaid = option?.name === 'raid' && command.name === 'roster'
    if (
      ['next', 'help'].includes(command.name) ||
      option?.type !== 4 ||
      (!isRaid && option.name !== 'page') ||
      seen.has(option.name) ||
      !Number.isInteger(option.value) ||
      option.value < 1 ||
      option.value > (isRaid ? 50 : command.name === 'roster' ? 20 : 10)
    )
      return null
    seen.add(option.name)
    if (isRaid) raid = option.value
    else page = option.value
  }
  return {
    name: command.name,
    page,
    ...(command.name === 'roster' ? { raid } : {}),
    args: {
      p_discord_id: user,
      p_discord_guild_id: interaction.guild_id,
      p_channel_id: interaction.channel_id,
    },
  }
}

function appLink(appUrl, guildId, route) {
  const url = new URL(appUrl)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('The app address must use HTTPS.')
  url.search = new URLSearchParams({ guild: guildId }).toString()
  url.hash = `/${route}`
  return url.href
}

const SIGNUP_LABELS = { signed: 'Signed up', late: 'Arriving late', tentative: 'Tentative', absent: 'Absent' }
function personalStatus(raid) {
  const mine = raid.mine ?? {}
  const parts = []
  if (mine.rostered) {
    parts.push(
      mine.response === 'confirmed'
        ? 'Roster confirmed'
        : mine.response === 'unavailable'
          ? "Rostered · you can't attend"
          : 'Rostered · confirmation needed',
    )
    if (mine.rosterCharacter)
      parts.push(`${escapeDiscord(mine.rosterCharacter)} · ${escapeDiscord(mine.rosterRole)}`)
  } else if (raid.published) parts.push('Not on the published roster')
  if (mine.status) {
    parts.push(SIGNUP_LABELS[mine.status] ?? 'Responded')
    if (mine.character && mine.status !== 'absent')
      parts.push(`${escapeDiscord(mine.character)} · ${escapeDiscord(mine.spec)} ${escapeDiscord(mine.role)}`)
    if (!raid.published && mine.bench)
      parts.push(`Signup bench · ${escapeDiscord(mine.role)} queue #${mine.place}`)
    if (mine.afterDeadline) parts.push('Changed after the check-in deadline')
  } else if (!mine.rostered) parts.push('No Discord signup yet')
  return parts.join(' — ')
}

function linksFor(raid, data, appUrl, manage = false) {
  const route = manage
    ? `planner/${raid.week}/${raid.raidId}`
    : raid.published
      ? `published/${raid.week}/${raid.raidId}`
      : `availability/${raid.week}`
  const links = [
    `[${manage ? 'Open planner' : raid.published ? 'View roster' : 'Set availability'}](${appLink(appUrl, data.guildId, route)})`,
  ]
  for (const [key, label] of [
    ['signupMessageId', 'Sign up in Discord'],
    ['rosterMessageId', 'Confirm in Discord'],
  ]) {
    if (
      SNOWFLAKE.test(raid[key] ?? '') &&
      SNOWFLAKE.test(data.channelId ?? '') &&
      SNOWFLAKE.test(data.serverId ?? '')
    )
      links.push(`[${label}](https://discord.com/channels/${data.serverId}/${data.channelId}/${raid[key]})`)
  }
  return links.join(' · ')
}

function officerReadiness(raid) {
  if (!raid.published)
    return 'Roster not published. Signup places are provisional; officers choose the final team.'
  const roles = ['Tank', 'Healer', 'DPS'].map((role, i) => ({
    role,
    missing: Math.max(0, (raid.rosterTargets?.[i] ?? raid.targets?.[i] ?? 0) - (raid.rosterCounts?.[i] ?? 0)),
  }))
  const need = roleNeeds(roles)
  return [
    need ? `Published roster needs ${need}.` : 'Published roster role targets filled.',
    `${raid.confirmed ?? 0} confirmed · ${raid.unconfirmed ?? 0} awaiting confirmation · ${raid.unavailable ?? 0} can't attend.`,
  ].join('\n')
}

function rosterReply(command, data, appUrl) {
  const raidNumber = command.raid ?? 1
  const raid = data.raids?.[raidNumber - 1]
  const plain = (content) => ({ content, embeds: [], components: [] })
  if (!raid)
    return plain('That raid is not in the upcoming list. Use /raid upcoming to find its current raid number.')
  const { lists, pages } = rosterPages(raid)
  const page = command.page ?? 1
  if (page > pages.length)
    return plain(
      `This roster has ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}. Use /raid roster raid:${raidNumber} page:${pages.length}.`,
    )
  const description = [
    `<t:${Math.floor(raid.start / 1000)}:F> · <t:${Math.floor(raid.start / 1000)}:R>`,
    raid.published
      ? '**Published roster** · Signup statuses are listed separately below.'
      : '**Provisional roster** · Officers choose the final team.',
    `Roster **${lists.roster.length}** · Bench **${lists.bench.length}** · Tentative **${lists.tentative.length}** · Absent **${lists.absent.length}**`,
    linksFor(raid, data, appUrl),
  ].join('\n')
  return {
    content: '',
    components: [],
    embeds: [
      {
        title: `#${raidNumber} · ${escapeDiscord(raid.raidName)}`.slice(0, 256),
        color: raid.published ? 0x5865f2 : 0x57f287,
        description,
        fields: pages[page - 1],
        footer: {
          text: `Page ${page}/${pages.length} · /raid roster raid:${raidNumber} page:${Math.min(page + 1, pages.length)}`,
        },
      },
    ],
  }
}

/** Bounded cards: five raids per page, or complete roster lists split across pages. */
export function raidCommandReply(command, data, appUrl) {
  const plain = (content) => ({ content, embeds: [], components: [] })
  if (command.name === 'help')
    return plain(
      [
        '**WhenToRaid · your raid hub**',
        '`/raid next` — next raid, role needs, and your answer.',
        '`/raid upcoming` — next four weeks; use `page` to browse.',
        '`/raid mine` — your signups, bench places, and roster confirmations.',
        '`/raid roster` — every roster, bench, tentative, and absent name. Use `raid` from /raid upcoming and `page` for long lists.',
        '`/raid readiness` — officer report on role gaps and confirmations.',
        'Use **Sign up**, **Late**, **Tentative**, or **Absent** on a signup post. Pick your character, then change spec for that raid if needed.',
        'A signup is provisional. Officers publish the final roster; use **Confirm** or **Can’t attend** on its post.',
        'Times display in your Discord timezone. These command replies are visible only to you.',
      ].join('\n'),
    )
  const errors = {
    'not-member':
      'Your Discord account is not linked to a WhenToRaid guild in this server. Ask an officer for an invite link.',
    ambiguous:
      'You belong to several guilds in this server. Run /raid in your guild’s connected bot channel. If they share a channel, ask an officer to give each guild its own channel.',
  }
  if (data?.outcome !== 'ok')
    return plain(errors[data?.outcome] ?? 'Raids could not be loaded. Try again in a moment.')
  if (command.name === 'readiness' && !data.officer)
    return plain(
      'Only WhenToRaid officers can view the readiness report. Use /raid next or /raid mine for your raids.',
    )
  if (command.name === 'roster') return rosterReply(command, data, appUrl)
  const raids = (data.raids ?? []).filter(
    (raid) => command.name !== 'mine' || raid.mine?.status || raid.mine?.rostered,
  )
  const page = command.page ?? 1
  const pages = Math.max(1, Math.ceil(raids.length / PAGE_SIZE))
  if (!raids.length)
    return plain(
      command.name === 'mine'
        ? 'No signups or roster places in the next four weeks. Use /raid upcoming to find a raid.'
        : 'No announced raids in the next four weeks. Officers can set a schedule and post signups in WhenToRaid.',
    )
  if (page > pages)
    return plain(
      `There are ${pages} ${pages === 1 ? 'page' : 'pages'} of raids. Try /raid ${command.name} page:${pages}.`,
    )
  const selected =
    command.name === 'next' ? raids.slice(0, 1) : raids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const fields = selected.map((raid) => {
    const seconds = Math.floor(raid.start / 1000)
    const end = Math.floor(raid.end / 1000)
    const summary = readinessText(signupReadiness(raid.signups ?? [], raid.targets ?? []))
    const lines = [`<t:${seconds}:F> → <t:${end}:t> · <t:${seconds}:R>`]
    if (command.name === 'readiness') lines.push(officerReadiness(raid), `**Signups:** ${summary}`)
    else lines.push(`**You:** ${personalStatus(raid)}`, `**Signups:** ${summary}`)
    lines.push(linksFor(raid, data, appUrl, command.name === 'readiness'))
    return {
      name: `#${data.raids.indexOf(raid) + 1} · ${escapeDiscord(raid.raidName)}`.slice(0, 120),
      value: lines.join('\n').slice(0, 1024),
    }
  })
  const titles = {
    next: 'Next raid',
    upcoming: 'Upcoming raids',
    mine: 'My raids',
    readiness: 'Raid readiness',
  }
  return {
    content: '',
    components: [],
    embeds: [
      {
        title: titles[command.name],
        color: 0x5865f2,
        description: `${escapeDiscord(data.guildName)} · Next four weeks`.slice(0, 180),
        fields,
        footer: {
          text:
            command.name === 'next'
              ? 'Signup places are provisional until officers publish the roster.'
              : `Page ${page}/${pages} · /raid ${command.name} page:${Math.min(page + 1, pages)}`,
        },
      },
    ],
  }
}
