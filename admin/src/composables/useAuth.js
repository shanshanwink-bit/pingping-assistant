import { readonly, ref } from 'vue'
import { api, session } from '../services/api'

const user = ref(null)
const ready = ref(false)

export function useAuth() {
  async function restore() {
    if (!session.token) { ready.value = true; return }
    try {
      const payload = await api.me()
      user.value = payload.user
    } catch (_) {
      session.clear()
    } finally {
      ready.value = true
    }
  }

  async function login(username, password) {
    user.value = await api.login(username, password)
  }

  async function logout() {
    const token = session.token
    session.clear()
    user.value = null
    location.hash = ''
    if (token) {
      try { await api.logout(token) } catch (_) { /* Local logout must not depend on network availability. */ }
    }
  }

  async function updateProfile(input) {
    const payload = await api.updateProfile(input)
    user.value = payload.user
    return payload.user
  }

  function clear() { session.clear(); user.value = null }

  return { user: readonly(user), ready: readonly(ready), restore, login, logout, updateProfile, clear }
}
