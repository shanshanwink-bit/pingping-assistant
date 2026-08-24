const defaultServerSync = require('../../utils/server-sync')
const { chooseProductImage, imageSizeText } = require('../../utils/ai-image')

const PRIVACY_NOTICE_KEY = 'ai_purchase_order_notice_v1'

function confirmPrivacyNotice(wxApi) {
  if (wxApi.getStorageSync(PRIVACY_NOTICE_KEY)) return Promise.resolve(true)
  return new Promise(resolve => {
    wxApi.showModal({
      title: '采购单图片使用说明',
      content: '采购单图片可能包含供应商、单号和金额，将通过第三方 AI 服务分析；识别完成后不会保存图片。',
      confirmText: '继续使用',
      cancelText: '暂不使用',
      success(result) {
        if (result.confirm) wxApi.setStorageSync(PRIVACY_NOTICE_KEY, true)
        resolve(Boolean(result.confirm))
      },
      fail() { resolve(false) }
    })
  })
}

function navigateToDraft(wxApi, draft) {
  return new Promise((resolve, reject) => {
    wxApi.navigateTo({
      url: '/pages/ai-purchase-draft/index',
      success(result) {
        if (!result.eventChannel || typeof result.eventChannel.emit !== 'function') {
          reject(new Error('草稿页面通信失败，请重新识别'))
          return
        }
        result.eventChannel.emit('purchaseDraft', draft)
        resolve()
      },
      fail(error) { reject(new Error(error.errMsg || '草稿页面打开失败，请重试')) }
    })
  })
}

function createAiPurchasePage(dependencies) {
  const deps = dependencies || {}
  const serverSync = deps.serverSync || defaultServerSync
  const wxApi = deps.wxApi || wx
  const chooseImageFile = deps.chooseProductImage || chooseProductImage
  const sizeText = deps.imageSizeText || imageSizeText
  const confirmNotice = deps.confirmPrivacyNotice || (() => confirmPrivacyNotice(wxApi))
  const openDraft = deps.navigateToDraft || (draft => navigateToDraft(wxApi, draft))

  return {
    data: {
      featureChecking: true,
      featureEnabled: false,
      featureError: '',
      selectedImage: '',
      selectedImageSize: '',
      recognizing: false,
      errorMessage: ''
    },

    onLoad() {
      wxApi.setNavigationBarTitle({ title: '拍照入库' })
      this.checkFeature()
    },

    async checkFeature() {
      this.setData({ featureChecking: true, featureError: '' })
      try {
        const features = await serverSync.pullFeatures()
        if (!features.aiImageRecognition) {
          this.setData({ featureChecking: false, featureEnabled: false })
          this.leaveDisabledPage()
          return
        }
        this.setData({ featureChecking: false, featureEnabled: true })
      } catch (error) {
        this.setData({
          featureChecking: false,
          featureEnabled: false,
          featureError: '功能状态读取失败，请返回 AI 商品助手重试'
        })
      }
    },

    leaveDisabledPage() {
      wxApi.showModal({
        title: '暂时无法使用',
        content: 'AI 商品助手当前未开启',
        showCancel: false,
        complete() {
          wxApi.navigateBack({ fail: () => wxApi.switchTab({ url: '/pages/inventory/index' }) })
        }
      })
    },

    async chooseImage() {
      if (this.data.recognizing || !this.data.featureEnabled) return
      if (!await confirmNotice()) return
      try {
        const image = await chooseImageFile()
        if (!image) return
        this.setData({
          selectedImage: image.path,
          selectedImageSize: sizeText(image.size),
          errorMessage: ''
        })
      } catch (error) {
        this.setData({ errorMessage: error.message || '图片选择失败，请重试' })
      }
    },

    removeImage() {
      if (this.data.recognizing) return
      this.setData({ selectedImage: '', selectedImageSize: '', errorMessage: '' })
    },

    async startRecognition() {
      if (this.data.recognizing || !this.data.featureEnabled) return
      if (!this.data.selectedImage) {
        this.setData({ errorMessage: '请先拍照或从相册选择进货单图片' })
        return
      }
      this.setData({ recognizing: true, errorMessage: '' })
      try {
        const result = await serverSync.recognizePurchaseOrderImage(this.data.selectedImage)
        const draft = result && result.draft
        if (!draft || !draft.draftId || !Array.isArray(draft.items)) {
          throw new Error('采购单识别结果不完整，请重新识别')
        }
        if (!draft.items.length) {
          const warning = Array.isArray(result.warnings) && result.warnings[0]
          throw new Error(warning || '未识别到采购商品明细，请拍清楚后重试')
        }
        await openDraft(draft)
      } catch (error) {
        if (error.statusCode === 403 && error.details && error.details.code === 'AI_FEATURE_DISABLED') {
          this.leaveDisabledPage()
          return
        }
        this.setData({ errorMessage: error.message || '采购单识别失败，请稍后重试' })
      } finally {
        this.setData({ recognizing: false })
      }
    }
  }
}

if (typeof Page === 'function') Page(createAiPurchasePage())

module.exports = {
  PRIVACY_NOTICE_KEY,
  confirmPrivacyNotice,
  createAiPurchasePage,
  navigateToDraft
}
