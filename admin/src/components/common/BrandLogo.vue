<script setup>
import logoUrl from '../../assets/brand/pingping-logo-256.png'

defineProps({
  size: {
    type: String,
    default: 'sidebar',
    validator: value => ['sidebar', 'login', 'mobile', 'boot'].includes(value)
  }
})
</script>

<template>
  <img class="brand-logo" :class="`brand-logo--${size}`" :src="logoUrl" alt="" aria-hidden="true" />
</template>

<style scoped>
.brand-logo {
  display: block;
  flex: none;
  object-fit: contain;
}

.brand-logo--sidebar {
  width: 38px;
  height: 38px;
}

.brand-logo--login {
  width: 46px;
  height: 46px;
}

.brand-logo--mobile {
  width: 38px;
  height: 38px;
}

.brand-logo--boot {
  width: 48px;
  height: 48px;
}
</style>
