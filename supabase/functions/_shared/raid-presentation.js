/** Display groups only: melee and ranged share the raid's existing DPS slot budget. */
export const ROLE_HEADINGS = {
  Tank: '🛡️ Tanks',
  Healer: '💚 Healers',
  DPS: '⚔️ DPS',
  Melee: '⚔️ Melee DPS',
  Ranged: '🏹 Ranged DPS',
  Unknown: '❔ DPS · spec needed',
}

/** Classic talent trees. Do not infer a hybrid's damage type without its spec. */
export function damageType(entry) {
  if (entry.role !== 'DPS') return null
  if (['Warrior', 'Paladin', 'Rogue'].includes(entry.class)) return 'Melee'
  if (['Hunter', 'Priest', 'Mage', 'Warlock'].includes(entry.class)) return 'Ranged'
  if (entry.class === 'Shaman')
    return entry.spec === 'Enhancement' ? 'Melee' : entry.spec === 'Elemental' ? 'Ranged' : 'Unknown'
  if (entry.class === 'Druid')
    return entry.spec === 'Feral Combat' ? 'Melee' : entry.spec === 'Balance' ? 'Ranged' : 'Unknown'
  return 'Unknown'
}

/** Always show both damage groups, and retain ambiguous legacy entries in their own group. */
export function displayRoles(roles) {
  return roles.flatMap((group) => {
    if (group.role !== 'DPS') return [group]
    return ['Melee', 'Ranged', 'Unknown']
      .map((role) => ({
        role,
        target: 0,
        members: group.members.filter((entry) => damageType(entry) === role),
      }))
      .filter((group) => group.role !== 'Unknown' || group.members.length)
  })
}

export function damageSummary(roles) {
  return displayRoles(roles)
    .filter(({ role }) => ['Melee', 'Ranged', 'Unknown'].includes(role))
    .map(({ role, members }) => `${ROLE_HEADINGS[role]} **${members.length}**`)
    .join(' · ')
}
