<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../services/api'
import { formatDateTime } from '../utils/format'
import { canAccess } from '../utils/access'

const props = defineProps({ currentUser: Object, onToast: Function })
const loading = ref(true)
const saving = ref(false)
const employees = ref([])
const roles = ref([])
const query = ref('')
const statusFilter = ref('')
const activeTab = ref('members')
const dialog = ref('')
const editingId = ref(null)
const error = ref('')
const form = reactive({ username: '', displayName: '', role: 'clerk', status: 'active', password: '', permissions: [] })

const permissionGroups = [
  ['经营看板', [['dashboard.view','查看经营看板']]],
  ['商品与库存', [['products.view','查看商品'],['products.edit','编辑商品'],['products.export','导出商品'],['inventory.view','查看库存'],['inventory.adjust','库存修正']]],
  ['销售与财务', [['sales.view','查看销售'],['sales.edit','新增/纠错销售'],['finance.cost.view','查看成本'],['finance.profit.view','查看盈利'],['finance.entry.edit','录入/冲正收支'],['reports.export','导出报表']]],
  ['系统管理', [['system.staff.manage','管理员工'],['system.settings.manage','基础设置'],['system.audit.view','查看审计日志']]]
]

const filteredEmployees = computed(() => employees.value.filter(item => {
  const keyword = query.value.trim().toLowerCase()
  return (!keyword || `${item.displayName} ${item.username} ${item.roleName}`.toLowerCase().includes(keyword)) && (!statusFilter.value || item.status === statusFilter.value)
}))
const activeCount = computed(() => employees.value.filter(item => item.status === 'active').length)
const selectedRole = computed(() => roles.value.find(role => role.key === form.role))
const canManage = computed(() => canAccess(props.currentUser, 'system.staff.manage'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const payload = await api.employees()
    employees.value = payload.items
    roles.value = payload.roles
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

function resetForm() {
  Object.assign(form, { username: '', displayName: '', role: 'clerk', status: 'active', password: '', permissions: rolePermissions('clerk') })
  editingId.value = null
  error.value = ''
}
function rolePermissions(key) { return [...(roles.value.find(role => role.key === key)?.permissions || [])] }
function chooseRole() { form.permissions = rolePermissions(form.role) }
function openCreate() { resetForm(); dialog.value = 'create' }
function openEdit(item) {
  editingId.value = item.id
  Object.assign(form, { username: item.username, displayName: item.displayName, role: item.role, status: item.status, password: '', permissions: [...item.permissions] })
  error.value = ''; dialog.value = 'edit'
}
function closeDialog() { if (!saving.value) dialog.value = '' }

async function save() {
  error.value = ''; saving.value = true
  try {
    if (dialog.value === 'create') {
      const payload = await api.createEmployee({ username: form.username, displayName: form.displayName, role: form.role, status: form.status, password: form.password })
      employees.value.push(payload.item)
      props.onToast?.(`已创建 ${payload.item.displayName} 的后台账号`)
    } else {
      const payload = await api.updateEmployee(editingId.value, { displayName: form.displayName, role: form.role, status: form.status, password: form.password, permissions: form.permissions })
      const index = employees.value.findIndex(item => item.id === editingId.value)
      employees.value[index] = payload.item
      props.onToast?.('员工权限已更新')
    }
    dialog.value = ''
    await load()
  } catch (err) { error.value = err.message } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <section class="employees-page">
    <div class="page-heading employees-heading"><div><span class="page-eyebrow">账号与访问控制</span><h2>员工与权限</h2><p>统一管理员工账号、角色和可访问的经营数据</p></div><button v-if="canManage" class="primary action-button" @click="openCreate"><span class="material-symbols-outlined">person_add</span>新增员工账号</button></div>
    <div class="access-summary">
      <article><i class="material-symbols-outlined blue">group</i><div><span>全部成员</span><strong>{{ employees.length }}</strong><small>含店主账号</small></div></article>
      <article><i class="material-symbols-outlined green">verified_user</i><div><span>正常使用</span><strong>{{ activeCount }}</strong><small>可登录后台</small></div></article>
      <article><i class="material-symbols-outlined amber">admin_panel_settings</i><div><span>角色模板</span><strong>{{ roles.length }}</strong><small>支持成员例外授权</small></div></article>
    </div>
    <div class="employees-tabs"><button :class="{active:activeTab==='members'}" @click="activeTab='members'">成员管理</button><button :class="{active:activeTab==='roles'}" @click="activeTab='roles'">角色权限</button></div>

    <article v-if="activeTab === 'members'" class="members-card">
      <div class="members-toolbar"><label><span class="material-symbols-outlined">search</span><input v-model="query" placeholder="搜索姓名、账号或角色" /></label><select v-model="statusFilter"><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option></select><span>共 {{ filteredEmployees.length }} 位成员</span></div>
      <div v-if="loading" class="content-state"><span class="button-spinner dark"></span>正在读取成员…</div>
      <div v-else-if="error && !employees.length" class="content-state error-state"><span class="material-symbols-outlined">cloud_off</span>{{ error }}<button @click="load">重新加载</button></div>
      <div v-else class="employee-table-wrap"><table class="employee-table"><thead><tr><th>成员</th><th>后台账号</th><th>角色</th><th>主要权限</th><th>最近登录</th><th>状态</th><th></th></tr></thead><tbody>
        <tr v-for="item in filteredEmployees" :key="item.id"><td><div class="member-cell"><span class="member-avatar">{{ item.displayName.slice(0,1) }}</span><div><b>{{ item.displayName }}</b><small v-if="item.id === currentUser?.id">当前账号</small></div></div></td><td class="mono">{{ item.username }}</td><td><span class="role-badge" :class="item.role">{{ item.roleName }}</span></td><td><div class="permission-preview"><span v-for="permission in item.permissions.slice(0,2)" :key="permission">{{ permissionGroups.flatMap(g=>g[1]).find(p=>p[0]===permission)?.[1] || permission }}</span><small v-if="item.permissions.length>2">+{{ item.permissions.length-2 }}</small></div></td><td class="muted">{{ formatDateTime(item.lastLoginAt) }}</td><td><span class="account-status" :class="item.status"><i></i>{{ item.status === 'active' ? '正常' : '已停用' }}</span></td><td><div v-if="canManage" class="member-actions"><button class="icon-action" aria-label="编辑成员" title="编辑成员" @click="openEdit(item)"><span class="material-symbols-outlined">edit</span></button></div></td></tr>
        <tr v-if="!filteredEmployees.length"><td colspan="7" class="empty-result">没有符合条件的员工</td></tr>
      </tbody></table></div>
    </article>

    <div v-else class="roles-grid">
      <article v-for="role in roles" :key="role.key" class="role-card"><div class="role-card-head"><span class="role-icon" :class="role.key"><i class="material-symbols-outlined">{{ role.key === 'owner' ? 'workspace_premium' : role.key === 'finance' ? 'account_balance_wallet' : role.key === 'admin' ? 'shield_person' : 'badge' }}</i></span><span class="role-badge" :class="role.key">{{ role.name }}</span><small>{{ role.memberCount }} 人</small></div><p>{{ role.description }}</p><div class="role-permissions"><b>默认权限</b><span v-for="permission in role.permissions.slice(0,5)" :key="permission"><i class="material-symbols-outlined">check_circle</i>{{ permissionGroups.flatMap(g=>g[1]).find(p=>p[0]===permission)?.[1] || permission }}</span><em v-if="role.permissions.length>5">另有 {{ role.permissions.length-5 }} 项权限</em></div></article>
    </div>

    <div v-if="dialog" class="dialog-backdrop" @mousedown.self="closeDialog"><form class="employee-dialog" @submit.prevent="save"><div class="dialog-head"><div><span class="page-eyebrow">{{ dialog === 'create' ? '新增后台账号' : '调整访问权限' }}</span><h3>{{ dialog === 'create' ? '新增员工账号' : `编辑 ${form.displayName}` }}</h3><p>{{ dialog === 'create' ? '创建后员工可使用该账号登录管理后台' : '修改将立即影响该账号的后台访问能力' }}</p></div><button type="button" aria-label="关闭" @click="closeDialog"><span class="material-symbols-outlined">close</span></button></div><div class="dialog-body">
      <div v-if="error" class="form-alert"><span class="material-symbols-outlined">error</span>{{ error }}</div>
      <div class="form-grid"><label>员工姓名<input v-model="form.displayName" required maxlength="40" placeholder="例如：小王" /></label><label>登录账号<input v-model="form.username" :disabled="dialog==='edit'" required pattern="[a-z0-9][a-z0-9._-]{2,31}" placeholder="3-32 位小写字母或数字" /></label><label>角色<select v-model="form.role" :disabled="editingId===currentUser?.id && currentUser?.role==='owner'" @change="chooseRole"><option v-for="role in roles" :key="role.key" :value="role.key">{{ role.name }}</option></select></label><label>账号状态<select v-model="form.status" :disabled="editingId===currentUser?.id"><option value="active">正常使用</option><option value="disabled">停用账号</option></select></label><label class="full">{{ dialog==='create' ? '初始密码' : '重置密码（留空则不修改）' }}<input v-model="form.password" :required="dialog==='create'" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位，建议包含大小写字母与数字" /></label></div>
      <div v-if="dialog==='edit'" class="permission-editor"><div><b>细粒度权限</b><small>当前基于“{{ selectedRole?.name }}”模板，可针对该成员单独调整</small></div><section v-for="group in permissionGroups" :key="group[0]"><h4>{{ group[0] }}</h4><label v-for="permission in group[1]" :key="permission[0]"><input v-model="form.permissions" type="checkbox" :value="permission[0]" :disabled="form.role==='owner'" /><span>{{ permission[1] }}</span></label></section></div>
    </div><div class="dialog-actions"><button type="button" class="secondary" @click="closeDialog">取消</button><button class="primary" :disabled="saving"><span v-if="saving" class="button-spinner"></span>{{ saving ? '保存中…' : '确认保存' }}</button></div></form></div>
  </section>
</template>
