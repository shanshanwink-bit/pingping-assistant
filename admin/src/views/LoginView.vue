<script setup>
import { ref } from 'vue'
import BrandLogo from '../components/common/BrandLogo.vue'

const props = defineProps({ onLogin: { type: Function, required: true } })
const username = ref(localStorage.getItem('pingping_admin_username') || '')
const password = ref('')
const remember = ref(Boolean(username.value))
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) { error.value = '请输入账号和密码'; return }
  loading.value = true
  try {
    await props.onLogin(username.value.trim(), password.value)
    remember.value ? localStorage.setItem('pingping_admin_username', username.value.trim()) : localStorage.removeItem('pingping_admin_username')
  } catch (err) {
    error.value = err.message
  } finally { loading.value = false }
}
</script>

<template>
  <main class="login-page">
    <div class="login-ambient" aria-hidden="true">
      <span class="ambient-orb orb-blue"></span>
      <span class="ambient-orb orb-violet"></span>
      <span class="ambient-orb orb-rose"></span>
      <span class="ambient-grid"></span>
    </div>

    <section class="login-story" aria-label="产品介绍">
      <div class="login-brand">
        <BrandLogo size="login" />
        <div><b>萍萍小助手</b><small>PINGPING ASSISTANT</small></div>
      </div>

      <div class="story-copy">
        <span class="eyebrow"><i></i> YOUR PRIVATE OPERATIONS SPACE</span>
        <h1>把复杂经营，<br /><em>变得从容。</em></h1>
        <p>商品、库存、经营数据与员工权限，在一个安全而清晰的工作台里自然协同。</p>
        <div class="story-points">
          <article><i class="material-symbols-outlined" aria-hidden="true">verified_user</i><div><b>权限清晰</b><small>独立账号与精细化访问控制</small></div></article>
          <article><i class="material-symbols-outlined" aria-hidden="true">database</i><div><b>数据自主</b><small>业务数据存储于自有服务器</small></div></article>
          <article><i class="material-symbols-outlined" aria-hidden="true">history</i><div><b>全程可溯</b><small>关键操作留痕，安心可查</small></div></article>
        </div>
      </div>

      <div class="story-footer">
        <span>© 2026 萍萍小助手</span>
        <span><i></i> 自有服务器安全部署</span>
      </div>
    </section>

    <section class="login-panel">
      <form class="login-card" @submit.prevent="submit">
        <div class="card-shine" aria-hidden="true"></div>
        <div class="mobile-brand"><BrandLogo size="mobile" /><div><b>萍萍小助手</b><small>管理后台</small></div></div>
        <div class="login-card-head">
          <span class="login-kicker">WELCOME BACK <i></i></span>
          <h2>欢迎回来</h2>
          <p>登录你的管理空间，继续今天的经营工作。</p>
        </div>
        <div v-if="error" class="form-alert" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span>{{ error }}</div>
        <label class="field-label"><span>账号</span>
          <span class="input-wrap"><span class="material-symbols-outlined" aria-hidden="true">person</span><input v-model="username" autocomplete="username" placeholder="请输入后台账号" autofocus /></span>
        </label>
        <label class="field-label"><span>密码</span>
          <span class="input-wrap"><span class="material-symbols-outlined" aria-hidden="true">lock</span><input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入密码" /><button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword"><span class="material-symbols-outlined" aria-hidden="true">{{ showPassword ? 'visibility_off' : 'visibility' }}</span></button></span>
        </label>
        <div class="login-options"><label><input v-model="remember" type="checkbox" />记住账号</label><span>忘记密码请联系店主重置</span></div>
        <button class="login-submit" type="submit" :disabled="loading"><span v-if="loading" class="button-spinner"></span><span>{{ loading ? '正在验证…' : '进入管理后台' }}</span><span v-if="!loading" class="submit-arrow material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
        <div class="login-security"><span class="material-symbols-outlined" aria-hidden="true">verified_user</span><span><b>安全连接</b>登录信息经加密会话传输，退出后令牌立即失效</span></div>
      </form>
    </section>
  </main>
</template>
