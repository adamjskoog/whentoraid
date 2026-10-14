<script>
  let { name, size = 20 } = $props()
  const paths = {
    home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    calendar:
      'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM16 3v4M8 3v4M3 11h18M8 15h2m4 0h2',
    character: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
    planner: 'M4 3h16v18H4ZM8 7h8M8 12h3M8 17h3m3-5 1 1 3-3m-4 7 1 1 3-3',
    members:
      'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v2M17 4a4 4 0 0 1 0 7m1 3a5 5 0 0 1 4 5v2',
    settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
    more: 'M5 11v2m7-2v2m7-2v2',
    lock: 'M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',
    unlock: 'M6 10h12v11H6ZM8 10V7a4 4 0 0 1 7-2m-3 10v2',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  }
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name] ?? paths.more} />
</svg>
