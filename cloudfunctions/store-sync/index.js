const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'store_states'
const RESOURCE_APP_ID = 'wx_resource_appid_here'

function validState(state) {
  return Boolean(
    state &&
    Array.isArray(state.products) &&
    Array.isArray(state.operations) &&
    Array.isArray(state.purchases) &&
    Array.isArray(state.sales) &&
    Array.isArray(state.manualProfits)
  )
}

exports.main = async event => {
  const context = cloud.getWXContext()
  const sourceAppId = context.FROM_APPID || context.APPID
  const sourceOpenId = context.FROM_OPENID || context.OPENID
  if (!sourceAppId || !sourceOpenId) return { ok: false, message: '无法识别小程序或微信账号' }
  // 资源方继续使用旧文档 ID，保证已有库存不迁移、不丢失；共享方使用 AppID 前缀隔离。
  const documentId = sourceAppId === RESOURCE_APP_ID
    ? `store_${sourceOpenId}`
    : `store_${sourceAppId}_${sourceOpenId}`

  try {
    if (event.action === 'pull') {
      try {
        const result = await db.collection(COLLECTION).doc(documentId).get()
        return {
          ok: true,
          exists: true,
          state: result.data.state,
          updatedAt: result.data.updatedAt || ''
        }
      } catch (error) {
        if (error.errCode === -1 || /not exist|does not exist|不存在/i.test(error.errMsg || error.message || '')) {
          return { ok: true, exists: false }
        }
        throw error
      }
    }

    if (event.action === 'push') {
      if (!validState(event.state)) return { ok: false, message: '库存数据格式不正确' }
      await db.collection(COLLECTION).doc(documentId).set({
        data: {
          sourceAppId,
          ownerOpenId: sourceOpenId,
          state: event.state,
          schemaVersion: 1,
          updatedAt: db.serverDate()
        }
      })
      return { ok: true }
    }

    return { ok: false, message: '不支持的同步操作' }
  } catch (error) {
    console.error('store-sync failed', error)
    return {
      ok: false,
      message: `云数据库操作失败：${error.errMsg || error.message || '未知错误'}`
    }
  }
}
