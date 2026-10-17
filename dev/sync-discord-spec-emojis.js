// Run with the application's existing credentials in the process environment. Never prints secrets.
import { installSpecEmojis } from '../supabase/functions/_shared/discord-spec-emojis.js'

try {
  const icons = await installSpecEmojis({
    applicationId: process.env.DISCORD_APPLICATION_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    progress: (name) => process.stdout.write(`Installed ${name}\n`),
  })
  process.stdout.write(`${Object.keys(icons).length} WoW spec icons ready. No channel messages sent.\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
