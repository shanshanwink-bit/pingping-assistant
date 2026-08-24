<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BrandLogo from './components/common/BrandLogo.vue'
import AdminSidebar from './components/layout/AdminSidebar.vue'
import AdminTopbar from './components/layout/AdminTopbar.vue'
import ProfileDialog from './components/account/ProfileDialog.vue'
import { useAuth } from './composables/useAuth'
import DashboardView from './views/DashboardView.vue'
import EmployeesView from './views/EmployeesView.vue'
import LoginView from './views/LoginView.vue'
import ProductsView from './views/ProductsView.vue'
import InventoryView from './views/InventoryView.vue'
import SalesFinanceView from './views/SalesFinanceView.vue'
import AnalysisView from './views/AnalysisView.vue'
import AuditLogsView from './views/AuditLogsView.vue'
import { canOpenPage, firstAllowedPage, NAV_ITEMS } from './utils/access'

const { user, ready, restore, login, logout, updateProfile, clear } = useAuth()
const validPages = NAV_ITEMS.map(item => item.id)
const activePage = ref(readPage())
const toast = ref('')
const showLogout = ref(false)
const loggingOut = ref(false)
const showProfile = ref(false)

function readPage() {
  const page = location.hash.replace('#', '') || 'dashboard'
  return validPages.includes(page) ? page : 'dashboard'
}
function navigate(page) {
	if (!canOpenPage(user.value, page)) { showToast('当前账号没有访问该模块的权限'); return }
  activePage.value = page
  location.hash = page === 'dashboard' ? '' : page
}
function syncHash() {
  const page = readPage()
  activePage.value = !user.value || canOpenPage(user.value, page) ? page : firstAllowedPage(user.value)
}
function showToast(message) {
  toast.value = message
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => { toast.value = '' }, 2600)
}
async function confirmLogout() {
  loggingOut.value = true
  try { await logout() } finally { loggingOut.value = false; showLogout.value = false }
}

watch(user, current => {
  if (current && !canOpenPage(current, activePage.value)) navigate(firstAllowedPage(current))
})

onMounted(async () => {
  window.addEventListener('hashchange', syncHash)
  window.addEventListener('admin:unauthorized', clear)
  await restore()
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncHash)
  window.removeEventListener('admin:unauthorized', clear)
})
</script>

<template>
  <div v-if="!ready" class="boot-screen"><BrandLogo size="boot" /><b>正在验证登录状态…</b><span class="boot-progress"></span></div>
  <LoginView v-else-if="!user" :on-login="login" />
  <div v-else class="app-shell">
    <AdminSidebar :active-page="activePage" :user="user" @navigate="navigate" @profile="showProfile=true" @logout="showLogout=true" />
    <AdminTopbar :active-page="activePage" />
    <main class="workspace" :class="{ 'products-workspace': activePage === 'products' }">
      <DashboardView v-if="activePage==='dashboard'" :current-user="user" @toast="showToast" @navigate="navigate" />
      <ProductsView v-else-if="activePage==='products'" :current-user="user" @toast="showToast" />
      <InventoryView v-else-if="activePage==='inventory'" @toast="showToast" />
      <SalesFinanceView v-else-if="activePage==='sales'" @toast="showToast" />
      <AnalysisView v-else-if="activePage==='analysis'" :current-user="user" @toast="showToast" />
      <EmployeesView v-else-if="activePage==='employees'" :current-user="user" :on-toast="showToast" />
      <AuditLogsView v-else-if="activePage==='audit'" />
    </main>
    <transition name="toast"><div v-if="toast" class="toast"><span class="material-symbols-outlined">check_circle</span>{{ toast }}</div></transition>
    <ProfileDialog v-if="showProfile" :user="user" :on-save="updateProfile" @close="showProfile=false" @saved="showProfile=false; showToast('个人资料已更新')" />
    <div v-if="showLogout" class="dialog-backdrop logout-backdrop" @mousedown.self="showLogout=false">
      <section class="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title"><span class="logout-illustration"><span class="material-symbols-outlined">logout</span></span><h3 id="logout-title">退出管理后台？</h3><p>退出后当前会话会立即失效，下次访问需要重新输入账号和密码。</p><div><button class="secondary" :disabled="loggingOut" @click="showLogout=false">继续使用</button><button class="danger-button" :disabled="loggingOut" @click="confirmLogout"><span v-if="loggingOut" class="button-spinner"></span>{{ loggingOut?'正在退出…':'确认退出' }}</button></div></section>
    </div>
  </div>
</template>
