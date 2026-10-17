/** Pure transport/formatting shared by Edge Functions and executable Vitest tests. */
const escapeIcs = (value) =>
  String(value ?? '')
    .replace(/[\\;,]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, '\\n')
    // Other control characters could break a calendar app's line parsing.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
const icsTime = (value) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
function fold(line) {
  const encoder = new TextEncoder()
  let current = '',
    bytes = 0
  const parts = []
  for (const character of line) {
    const size = encoder.encode(character).length
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += character
    bytes += size
  }
  return [...parts, current].join('\r\n ')
}

export function personalCalendar(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhenToRaid//Personal raids//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:My raids',
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.guild_id}-${event.week}-${event.raid_id}-${event.member_id}@whentoraid`,
      `SEQUENCE:${event.sequence}`,
      `DTSTAMP:${icsTime(event.updated_at)}`,
      `LAST-MODIFIED:${icsTime(event.updated_at)}`,
      `DTSTART:${icsTime(Number(event.start_ms))}`,
      `DTEND:${icsTime(Number(event.end_ms))}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(event.description)}`,
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Player-chosen names must not ping, format, or become links (masked or bare) in the channel. */
export const escapeDiscord = (value) =>
  String(value ?? '')
    .replace(/@/g, '@\u200b')
    .replace(/([\\`*_~|<>[\]()#])/g, '\\$1')
    .replace(/:\/\//g, ':\u200b//')
    .replace(/\./g, '.\u200b')
    .replace(/[\r\n]/g, ' ')
export function reminderMessages(payload) {
  const targets = (payload.recipients ?? []).map((member) =>
    /^\d{17,20}$/.test(member.discordId) ? `<@${member.discordId}>` : escapeDiscord(member.name),
  )
  const heading =
    payload.kind === 'checkin'
      ? `Please check in for the week of ${payload.week}.`
      : `${escapeDiscord(payload.raidName)} starts <t:${Math.floor(payload.start / 1000)}:R>. Please confirm your place.`
  if (!targets.length) return []
  const messages = []
  let text = `${heading}\nWaiting on: `
  for (const target of targets) {
    if (text.length + target.length + 2 > 1900) {
      messages.push(text)
      text = `${heading}\nWaiting on: `
    }
    text += `${target}, `
  }
  messages.push(text.replace(/, $/, ''))
  return messages
}

const WEBHOOK_URL =
  /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,100}$/

/**
 * Where messages go: a channel webhook URL, or `{ type: 'bot', channelId, token }` for messages the
 * application posts itself. Only bot messages can carry response buttons.
 */
function transport(target) {
  if (target?.type === 'bot') {
    if (!/^\d{17,20}$/.test(target.channelId ?? '') || !target.token)
      throw new Error('Reconnect the Discord channel in Guild settings.')
    const base = `https://discord.com/api/v10/channels/${target.channelId}/messages`
    return {
      create: base,
      message: (id) => `${base}/${id}`,
      headers: { Authorization: `Bot ${target.token}` },
      interactive: true,
    }
  }
  if (!WEBHOOK_URL.test(target)) throw new Error('Reconnect the Discord channel in Guild settings.')
  return {
    create: `${target}?wait=true`,
    message: (id) => `${target}/messages/${id}`,
    headers: {},
    interactive: false,
  }
}

/**
 * Creates are checkpointed immediately. An ambiguous create must be reconciled, never blindly retried.
 * `components` (bot targets only) go on the last message; edits replace them, so a cancelled
 * roster's buttons disappear.
 */
export async function deliverMessages(
  target,
  messages,
  previousIds,
  { fetchFn = fetch, checkpoint, mentionIds = [], components = [] },
) {
  const route = transport(target)
  const ids = [...previousIds]
  async function request(method, url, body) {
    let response
    try {
      response = await fetchFn(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', ...route.headers },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw Object.assign(
        new Error(
          method === 'POST'
            ? 'Delivery may have succeeded. Check Discord before retrying to avoid a duplicate.'
            : 'Discord could not be reached.',
        ),
        { uncertain: method === 'POST' },
      )
    }
    if (!response.ok) {
      const retryAfter =
        response.status === 429 ? Number((await response.json().catch(() => ({}))).retry_after) : 0
      throw Object.assign(new Error(`Discord returned ${response.status}.`), {
        status: response.status,
        retryAfter,
        uncertain: method === 'POST' && response.status >= 500,
      })
    }
    if (response.status === 204) return null
    try {
      return await response.json()
    } catch {
      throw Object.assign(
        new Error('Discord returned an unreadable response. Check the channel before retrying.'),
        { uncertain: method === 'POST' },
      )
    }
  }
  for (const [index, outgoing] of messages.entries()) {
    // Text, or `{ content, embeds }`. Every message sets both, so an edit replaces either kind.
    const { content = '', embeds = [] } = typeof outgoing === 'string' ? { content: outgoing } : outgoing
    const body = {
      content,
      embeds,
      allowed_mentions: {
        parse: [],
        users: ids[index] ? [] : mentionIds.filter((id) => /^\d{17,20}$/.test(id)).slice(0, 100),
      },
      ...(route.interactive ? { components: index === messages.length - 1 ? components : [] } : {}),
    }
    if (ids[index]) {
      try {
        await request('PATCH', route.message(ids[index]), body)
        continue
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
    const message = await request('POST', route.create, body)
    if (!/^\d{17,20}$/.test(message?.id))
      throw Object.assign(
        new Error('Discord did not return a message identifier. Check the channel before retrying.'),
        { uncertain: true },
      )
    ids[index] = message.id
    try {
      await checkpoint([...ids])
    } catch {
      throw Object.assign(
        new Error('Message sent, but its receipt could not be saved. Check Discord before retrying.'),
        { uncertain: true },
      )
    }
  }
  while (ids.length > messages.length) {
    try {
      await request('DELETE', route.message(ids.at(-1)))
    } catch (error) {
      if (error.status !== 404) throw error
    }
    ids.pop()
    await checkpoint([...ids])
  }
  return ids
}
