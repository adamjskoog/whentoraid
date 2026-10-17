/** Lossless Discord list pagination. Never cut a player's name or replace entries with "N more". */
export function listFields(name, items, { inline = false, joiner = '\n' } = {}) {
  const values = []
  let value = ''
  for (const item of items) {
    if (item.length > 1024) throw new Error('A roster entry exceeds the Discord field limit.')
    if (value && value.length + joiner.length + item.length > 1024) {
      values.push(value)
      value = ''
    }
    value += (value ? joiner : '') + item
  }
  values.push(value || 'None')
  return values.map((text, index) => ({ name: index ? `${name} (continued)` : name, value: text, inline }))
}

/** Leave room for a title, description, footer and author within Discord's 6000-character limit. */
export function fieldPages(fields, budget = 4600) {
  const pages = [[]]
  let used = 0
  for (const field of fields) {
    const size = field.name.length + field.value.length
    if (size > budget) throw new Error('A roster field exceeds the Discord page limit.')
    if (used + size > budget || pages.at(-1).length === 25) {
      pages.push([])
      used = 0
    }
    pages.at(-1).push(field)
    used += size
  }
  return pages
}
