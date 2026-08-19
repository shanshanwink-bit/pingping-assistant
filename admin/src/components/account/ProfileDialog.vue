<script setup>
import { ref } from 'vue'
import { prepareAvatar } from '../../utils/avatar'

const props = defineProps({ user: { type: Object, required: true }, onSave: { type: Function, required: true } })
const emit = defineEmits(['close', 'saved'])
const displayName = ref(props.user.displayName || '')
const avatarUrl = ref(props.user.avatarUrl || '')
const fileInput = ref(null)
const processingImage = ref(false)
const saving = ref(false)
const error = ref('')

async function selectAvatar(event) {
  const [file] = event.target.files || []
  if (!file) return
  processingImage.value = true
  error.value = ''
  try {
    avatarUrl.value = await prepareAvatar(file)
  } catch (cause) {
    error.value = cause.message
  } finally {
    processingImage.value = false
    event.target.value = ''
  }
}

async function submit() {
  error.value = ''
  if (!displayName.value.trim()) { error.value = '请输入显示名称'; return }
  saving.value = true
  try {
    await props.onSave({ displayName: displayName.value.trim(), avatarUrl: avatarUrl.value })
    emit('saved')
  } catch (cause) {
    error.value = cause.message || '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dialog-backdrop" @mousedown.self="emit('close')">
    <form class="profile-dialog" @submit.prevent="submit">
      <header class="dialog-head">
        <div><span class="page-eyebrow">ACCOUNT PROFILE</span><h3>个人资料</h3><p>更新头像和在后台显示的名称。</p></div>
        <button type="button" aria-label="关闭" @click="emit('close')"><span class="material-symbols-outlined">close</span></button>
      </header>
      <div class="profile-body">
        <section class="avatar-editor">
          <span class="profile-avatar"><img v-if="avatarUrl" :src="avatarUrl" alt="头像预览"><template v-else>{{ displayName.trim().slice(0,1) || '管' }}</template></span>
          <div><b>账户头像</b><p>支持 JPG、PNG、WebP，系统会自动裁剪为方形。</p><span class="avatar-actions"><button type="button" class="secondary" :disabled="processingImage" @click="fileInput.click()">{{ processingImage ? '正在处理…' : '选择图片' }}</button><button v-if="avatarUrl" type="button" class="text-button" @click="avatarUrl=''">移除头像</button></span></div>
          <input ref="fileInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" @change="selectAvatar">
        </section>
        <div class="profile-fields">
          <label>显示名称<input v-model="displayName" maxlength="40" autocomplete="name" placeholder="请输入显示名称"></label>
          <label>登录账号<input :value="user.username" disabled><small>登录账号由员工与权限模块统一管理。</small></label>
          <label>当前角色<input :value="user.roleName" disabled></label>
        </div>
        <div v-if="error" class="form-alert">{{ error }}</div>
      </div>
      <footer class="dialog-actions"><button type="button" class="secondary" :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="saving||processingImage"><span v-if="saving" class="button-spinner"></span>{{ saving ? '保存中…' : '保存资料' }}</button></footer>
    </form>
  </div>
</template>
