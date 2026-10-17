import { describe, expect, it, vi } from 'vitest'
import {
  SPEC_EMOJI_CATALOG,
  createSpecEmojiLoader,
  installSpecEmojis,
} from '../../supabase/functions/_shared/discord-spec-emojis.js'

const APP = '123456789012345678'
const ID = '223456789012345678'
const items = SPEC_EMOJI_CATALOG.map(({ name }) => ({ name, id: ID }))
const reply = (items) => new Response(JSON.stringify({ items }))

describe('application spec emojis', () => {
  it('has a unique valid Discord name for every Classic spec', () => {
    expect(SPEC_EMOJI_CATALOG).toHaveLength(27)
    expect(new Set(items.map(({ name }) => name)).size).toBe(27)
    for (const { name, url } of SPEC_EMOJI_CATALOG) {
      expect(name).toMatch(/^[a-z0-9_]{2,32}$/)
      expect(url).toMatch(/^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/medium\/[a-z0-9_]+\.jpg$/)
    }
  })

  it('caches and coalesces lookups, ignoring unrelated and malformed emojis', async () => {
    const fetchFn = vi.fn(async () =>
      reply([
        ...items,
        { name: '__proto__', id: ID },
        { name: 'unrelated', id: ID },
        { name: 'wtr_priest_shadow', id: 'bad' },
      ]),
    )
    const loader = createSpecEmojiLoader({ applicationId: APP, botToken: 'secret', fetchFn })
    const [first, second] = await Promise.all([loader(), loader()])
    expect(first).toEqual(second)
    expect(first.wtr_priest_shadow).toBe(ID)
    expect(Object.keys(first)).toHaveLength(27)
    await loader()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('keeps last known icons on an outage and backs off failed lookups', async () => {
    let time = 0
    const log = vi.fn()
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async () => reply(items))
      .mockResolvedValue(new Response(null, { status: 429 }))
    const loader = createSpecEmojiLoader({
      applicationId: APP,
      botToken: 'secret',
      fetchFn,
      now: () => time,
      log,
    })
    expect((await loader()).wtr_priest_shadow).toBe(ID)
    time += 300001
    expect((await loader()).wtr_priest_shadow).toBe(ID)
    await loader()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('429'))
    expect(await createSpecEmojiLoader({ log })()).toEqual({})
  })

  it('uploads only missing specs and never sends the bot token to the artwork host', async () => {
    const fetchFn = vi.fn(async (url, init = {}) => {
      if (url.startsWith('https://wow.zamimg.com/')) {
        expect(init.headers).toBeUndefined()
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
      }
      expect(url).toBe(`https://discord.com/api/v10/applications/${APP}/emojis`)
      expect(init.headers.Authorization).toBe('Bot secret')
      if (!init.method) return reply(items.filter(({ name }) => name !== 'wtr_priest_shadow'))
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({
        name: 'wtr_priest_shadow',
        image: 'data:image/jpeg;base64,/9j/2Q==',
      })
      return new Response(JSON.stringify({ id: ID }))
    })
    expect(
      Object.keys(await installSpecEmojis({ applicationId: APP, botToken: 'secret', fetchFn })),
    ).toHaveLength(27)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('does not upload anything when already installed and refuses invalid images', async () => {
    const installed = vi.fn(async () => reply(items))
    await installSpecEmojis({ applicationId: APP, botToken: 'secret', fetchFn: installed })
    expect(installed).toHaveBeenCalledTimes(1)
    const invalid = vi
      .fn()
      .mockImplementationOnce(async () => reply(items.slice(1)))
      .mockResolvedValue(new Response('not an image'))
    await expect(
      installSpecEmojis({ applicationId: APP, botToken: 'secret', fetchFn: invalid }),
    ).rejects.toThrow('Invalid JPEG')
    expect(invalid).toHaveBeenCalledTimes(2)
  })
})
