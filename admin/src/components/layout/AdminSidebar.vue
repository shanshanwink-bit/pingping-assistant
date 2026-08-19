<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { visibleNavItems } from '../../utils/access'

const props = defineProps({ activePage: String, user: Object })
const emit = defineEmits(['navigate', 'profile', 'logout'])
const menuOpen = ref(false)
const accountArea = ref(null)

function closeFromOutside(event) {
  if (!accountArea.value?.contains(event.target)) menuOpen.value = false
}
function choose(action) {
  menuOpen.value = false
  emit(action)
}

onMounted(() => window.addEventListener('pointerdown', closeFromOutside))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeFromOutside))

const navItems = computed(() => visibleNavItems(props.user))
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <div class="brand">
      <div class="brand-icon"><span class="material-symbols-outlined">storefront</span></div>
      <div><h1>萍萍小助手</h1><p>管理后台</p></div>
    </div>
    <nav class="navigation">
      <a v-for="item in navItems" :key="item.id" href="#" :class="{ active: activePage === item.id }" @click.prevent="$emit('navigate', item.id)">
        <span class="material-symbols-outlined">{{ item.icon }}</span><span>{{ item.label }}</span>
      </a>
    </nav>
    <div ref="accountArea" class="sidebar-footer account-area">
      <div v-if="menuOpen" class="account-menu" role="menu">
        <button role="menuitem" @click="choose('profile')"><span class="material-symbols-outlined">manage_accounts</span><span>编辑个人资料</span></button>
        <button class="account-menu-logout" role="menuitem" @click="choose('logout')"><span class="material-symbols-outlined">logout</span><span>退出登录</span></button>
      </div>
      <button class="account-button" :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen=!menuOpen">
        <span class="avatar-small"><img v-if="user?.avatarUrl" :src="user.avatarUrl" alt=""><template v-else>{{ user?.displayName?.slice(0, 1) || '管' }}</template></span>
        <span><b>{{ user?.displayName }}</b><small>{{ user?.roleName }}</small></span>
        <span class="account-chevron" aria-hidden="true">{{ menuOpen ? '⌃' : '⌄' }}</span>
      </button>
    </div>
  </aside>
</template>
