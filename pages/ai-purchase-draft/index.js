const defaultAuth = require('../../utils/auth')
const draftState = require('../../utils/ai-purchase-draft')
const defaultServerSync = require('../../utils/server-sync')
const defaultStore = require('../../utils/store')

function confirmSubmission(wxApi, lineCount, totalCostText) {
  return new Promise(resolve => {
    wxApi.showModal({
      title: '确认入库',
      content: `共 ${lineCount} 行，合计 ${totalCostText}。确认后将更新库存并生成采购记录。`,
      confirmText: '确认入库',
      cancelText: '再核对一下',
      success: result => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    })
  })
}

function submitErrorView(error) {
  const statusCode = Number(error && error.statusCode || 0)
  const code = error && error.details && error.details.code
  const message = String(error && error.message || '').trim()
  if (statusCode === 404) {
    return {
      title: '商品数据已变化',
      text: `${message || '商品或规格不存在'}。事务未完成，库存未发生变化。`
    }
  }
  if (statusCode === 409 && code === 'BATCH_TRANSACTION_CONFLICT') {
    return {
      title: '批次内容冲突',
      text: `${message || '该批次已被不同内容使用'}。库存未因本次提交发生变化，请重新识别后核对。`
    }
  }
  if (statusCode === 409 && code === 'PRODUCT_INACTIVE') {
    return {
      title: '商品已停用',
      text: `${message || '商品已停用，请先重新启用'}。整批事务已回滚，库存和采购记录均未修改。`
    }
  }
  if (!statusCode) {
    return {
      title: '网络连接失败',
      text: '未收到服务器成功结果，本地库存未更新。请保留当前草稿并使用同一批次重试，幂等机制不会重复入库。'
    }
  }
  return {
    title: '入库事务失败',
    text: `${message || '服务器未能完成入库'}。事务未完成，库存未发生变化。`
  }
}

function createAiPurchaseDraftPage(dependencies) {
  const deps = dependencies || {}
  const wxApi = deps.wxApi || wx
  const serverSync = deps.serverSync || defaultServerSync
  const persistState = deps.persistState || (state => defaultStore.replaceStateFromServer(
    state,
    defaultAuth.getCurrentUser() || state.currentUser || {}
  ))
  const requestConfirm = deps.confirmSubmission || ((lineCount, totalCostText) => (
    confirmSubmission(wxApi, lineCount, totalCostText)
  ))

  return {
  data: {
    draftId: '',
    items: [],
    empty: true,
    canConfirm: false,
    totalCostText: '¥0.00',
    loadError: '',
    isSubmitting: false,
    submitErrorTitle: '',
    submitErrorText: '',
    success: false,
    successTitle: '',
    successMessage: ''
  },

  onLoad() {
    wxApi.setNavigationBarTitle({ title: '入库草稿' })
    const channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
    if (!channel || typeof channel.on !== 'function') {
      this.setData({ loadError: '草稿已失效，请重新识别采购单' })
      return
    }
    channel.on('purchaseDraft', draft => this.receiveDraft(draft))
  },

  receiveDraft(draft) {
    const normalized = draftState.normalizeDraft(draft)
    if (!normalized.draftId) {
      this.setData({ loadError: '草稿数据不完整，请重新识别采购单' })
      return
    }
    this._draft = normalized
    this.refreshView()
  },

  refreshView() {
    const view = draftState.presentDraft(this._draft)
    this._draft = view.draft
    this.setData({
      draftId: view.draft.draftId,
      items: view.items,
      empty: view.empty,
      canConfirm: view.canConfirm,
      totalCostText: view.totalCostText,
      loadError: '',
      submitErrorTitle: '',
      submitErrorText: ''
    })
  },

  selectProduct(event) {
    if (this.data.isSubmitting) return
    this._draft = draftState.selectProduct(
      this._draft,
      event.currentTarget.dataset.lineId,
      event.currentTarget.dataset.productId
    )
    this.refreshView()
  },

  selectSpec(event) {
    if (this.data.isSubmitting) return
    this._draft = draftState.selectSpec(
      this._draft,
      event.currentTarget.dataset.lineId,
      event.currentTarget.dataset.specId
    )
    this.refreshView()
  },

  onQuantityInput(event) {
    if (this.data.isSubmitting) return
    this._draft = draftState.updateQuantity(
      this._draft,
      event.currentTarget.dataset.lineId,
      event.detail.value
    )
    this.refreshView()
  },

  onUnitCostInput(event) {
    if (this.data.isSubmitting) return
    this._draft = draftState.updateUnitCost(
      this._draft,
      event.currentTarget.dataset.lineId,
      event.detail.value
    )
    this.refreshView()
  },

  removeItem(event) {
    if (this.data.isSubmitting) return
    const lineId = event.currentTarget.dataset.lineId
    wxApi.showModal({
      title: '删除这一行？',
      content: '只会从当前草稿中删除，不会修改库存。',
      success: result => {
        if (!result.confirm) return
        this._draft = draftState.removeItem(this._draft, lineId)
        this.refreshView()
      }
    })
  },

  async confirmDraft() {
    if (this.data.isSubmitting || !draftState.canConfirm(this._draft)) return
    if (!await requestConfirm(this.data.items.length, this.data.totalCostText)) return
    let payload
    try {
      payload = draftState.batchPayload(this._draft)
    } catch (error) {
      this.setData({ submitErrorTitle: '草稿无法提交', submitErrorText: error.message })
      return
    }
    this.setData({ isSubmitting: true, submitErrorTitle: '', submitErrorText: '' })
    let result
    try {
      result = await serverSync.commitPurchaseBatch(payload)
    } catch (error) {
      const issue = submitErrorView(error)
      this.setData({ submitErrorTitle: issue.title, submitErrorText: issue.text })
      return
    } finally {
      this.setData({ isSubmitting: false })
    }

    if (!result || !result.state || !Array.isArray(result.transactions)) {
      const issue = submitErrorView({ statusCode: 502, message: '服务器返回的入库结果不完整' })
      this.setData({ submitErrorTitle: issue.title, submitErrorText: issue.text })
      return
    }
    try {
      persistState(result.state)
    } catch (error) {
      this.setData({
        success: true,
        successTitle: result.duplicate ? '该批次已处理' : '入库已完成',
        successMessage: '服务器已完成入库，但本地库存刷新失败，请返回商品页重新加载。'
      })
      return
    }
    this.setData({
      success: true,
      successTitle: result.duplicate ? '该批次已处理' : '入库成功',
      successMessage: result.duplicate
        ? '库存此前已经更新，本次没有重复增加。'
        : `已完成 ${result.transactions.length} 行入库，库存和采购记录已刷新。`,
      submitErrorTitle: '',
      submitErrorText: ''
    })
    wxApi.showToast({ title: result.duplicate ? '该批次已处理' : '入库成功', icon: 'success' })
  },

  finish() {
    wxApi.switchTab({ url: '/pages/inventory/index' })
  },

  viewPurchases() {
    wxApi.navigateTo({ url: '/pages/purchases/index' })
  }
  }
}

if (typeof Page === 'function') Page(createAiPurchaseDraftPage())

module.exports = {
  confirmSubmission,
  createAiPurchaseDraftPage,
  submitErrorView
}
