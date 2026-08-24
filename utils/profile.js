const APP_VERSION = '1.2.0'
const ADMIN_CONSOLE_URL = 'https://shanshanwink.online/pingping/'

const ROLE_LABELS = {
  owner: '店主',
  admin: '管理员',
  finance: '财务',
  clerk: '店员'
}

function cleanText(value) {
  return String(value || '').trim()
}

function maskAccount(value) {
  const account = cleanText(value)
  if (!account) return '微信账号'
  if (account.length <= 10) return account
  return `${account.slice(0, 6)}••••${account.slice(-4)}`
}

function buildUserView(user) {
  const source = user || {}
  const name = cleanText(source.name) || '用户'
  const avatarUrl = cleanText(source.avatarUrl)
  const roleLabel = ROLE_LABELS[cleanText(source.role)] || ''

  return {
    name,
    avatarUrl,
    hasAvatar: Boolean(avatarUrl),
    avatarText: name.slice(0, 1) || '用',
    roleLabel,
    storeName: cleanText(source.storeName),
    accountDisplay: maskAccount(source.openid || source.account)
  }
}

function formatSyncTime(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function buildSyncView(status) {
  const source = status || {}
  const syncedTime = formatSyncTime(source.lastSyncAt)

  if (source.state === 'failed') {
    return { state: 'failed', label: '同步失败', detail: '请检查网络后重试', canRetry: true }
  }
  if (source.state === 'pending') {
    return { state: 'pending', label: '待同步', detail: '正在同步经营数据', canRetry: false }
  }
  if (source.state === 'synced') {
    return {
      state: 'synced',
      label: '已同步',
      detail: syncedTime ? `最近同步 ${syncedTime}` : '数据已同步',
      canRetry: false
    }
  }
  return { state: 'connected', label: '数据连接正常', detail: '暂无待同步数据', canRetry: false }
}

function shouldConfirmLogout(result) {
  return Boolean(result && result.confirm)
}

module.exports = {
  APP_VERSION,
  ADMIN_CONSOLE_URL,
  buildUserView,
  buildSyncView,
  shouldConfirmLogout
}
