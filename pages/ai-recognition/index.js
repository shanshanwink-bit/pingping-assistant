const serverSync = require('../../utils/server-sync')
const store = require('../../utils/store')
const { productDetailUrl } = require('../../utils/product-display')
const { chooseProductImage, imageSizeText } = require('../../utils/ai-image')

const PRIVACY_NOTICE_KEY = 'ai_image_recognition_notice_v1'

function money(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? `¥${number.toFixed(2)}` : '暂无'
}

function dateText(value) {
  const text = String(value || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '暂无'
}

function presentCandidate(item) {
  const recent = item && item.recentPurchase
  return {
    ...item,
    typeLabel: item.businessType === 'cosmetics' ? '化妆品' : '服装',
    specText: Array.isArray(item.specs) && item.specs.length ? item.specs.join('、') : '暂无规格信息',
    salePriceText: money(item.salePrice),
    stockText: String(Math.max(0, Number(item.stock || 0))),
    recentPurchaseText: recent ? dateText(recent.occurredAt) : '暂无进货记录',
    recentCostText: recent && recent.unitCost !== null ? money(recent.unitCost) : '暂无可靠进价',
    matchReasonText: Array.isArray(item.matchReasons) ? item.matchReasons.join('、') : '',
    firstPurchaseText: item.purchaseHistoryReliable && item.firstPurchase
      ? dateText(item.firstPurchase.occurredAt)
      : ''
  }
}

function confirmPrivacyNotice() {
  if (wx.getStorageSync(PRIVACY_NOTICE_KEY)) return Promise.resolve(true)
  return new Promise(resolve => {
    wx.showModal({
      title: '图片使用说明',
      content: '所选图片将用于商品识别，并通过第三方 AI 服务进行分析。识别完成后不会保存为商品图片。',
      confirmText: '继续使用',
      cancelText: '暂不使用',
      success(result) {
        if (result.confirm) wx.setStorageSync(PRIVACY_NOTICE_KEY, true)
        resolve(Boolean(result.confirm))
      },
      fail() { resolve(false) }
    })
  })
}

Page({
  data: {
    featureChecking: true,
    featureEnabled: false,
    featureError: '',
    selectedImage: '',
    selectedImageSize: '',
    recognizing: false,
    errorMessage: '',
    matchType: '',
    candidates: [],
    visionSummary: ''
  },

  onLoad() {
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
        featureError: '功能状态读取失败，请返回商品页重试'
      })
    }
  },

  leaveDisabledPage() {
    wx.showModal({
      title: '暂时无法使用',
      content: 'AI 拍照识货当前未开启',
      showCancel: false,
      complete() {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/inventory/index' }) })
      }
    })
  },

  async chooseImage() {
    if (this.data.recognizing || !this.data.featureEnabled) return
    if (!await confirmPrivacyNotice()) return
    try {
      const image = await chooseProductImage()
      if (!image) return
      this.setData({
        selectedImage: image.path,
        selectedImageSize: imageSizeText(image.size),
        errorMessage: '',
        matchType: '',
        candidates: [],
        visionSummary: ''
      })
    } catch (error) {
      this.setData({ errorMessage: error.message || '图片选择失败，请重试' })
    }
  },

  async startRecognition() {
    if (this.data.recognizing || !this.data.featureEnabled) return
    if (!this.data.selectedImage) {
      this.setData({ errorMessage: '请先拍照或从相册选择图片' })
      return
    }
    this.setData({ recognizing: true, errorMessage: '', matchType: '', candidates: [] })
    try {
      const result = await serverSync.recognizeProductImage(this.data.selectedImage)
      const vision = result.vision || {}
      this.setData({
        matchType: result.matchType || 'none',
        candidates: (Array.isArray(result.items) ? result.items : []).map(presentCandidate),
        visionSummary: [vision.productName, vision.brand, vision.spec].filter(Boolean).join(' · ') || '已提取图片中的商品特征'
      })
    } catch (error) {
      if (error.statusCode === 403 && error.details && error.details.code === 'AI_FEATURE_DISABLED') {
        this.leaveDisabledPage()
        return
      }
      this.setData({ errorMessage: error.message || '识别失败，请稍后重试' })
    } finally {
      this.setData({ recognizing: false })
    }
  },

  openProduct(event) {
    const index = Number(event.currentTarget.dataset.index)
    const candidate = this.data.candidates[index]
    if (!candidate) return
    const product = store.getProducts().find(item => (
      String(item.id) === String(candidate.id) ||
      (candidate.adminProductId && Number(item.adminProductId) === Number(candidate.adminProductId)) ||
      (candidate.code && String(item.code) === String(candidate.code))
    ))
    if (!product) {
      wx.showToast({ title: '商品数据已变化，请返回商品页刷新', icon: 'none' })
      return
    }
    wx.navigateTo({ url: productDetailUrl(product.id) })
  }
})
