<script>
  let { eyebrow, title, subtitle, action } = $props()
</script>

<div class="title-row">
  <div>
    <div class="eyebrow gold">{eyebrow}</div>
    <h1>{title}</h1>
    <p class="subtitle">{subtitle}</p>
  </div>
  {@render action?.()}
</div>
