function text(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function positiveInteger(value) {
  if (text(value) === '') return null
  const result = Number(value)
  return Number.isInteger(result) && result > 0 ? result : null
}

function positiveMoney(value) {
  if (text(value) === '') return null
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? Math.round(result * 100) / 100 : null
}

function money(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? `¥${amount.toFixed(2)}` : '待填写'
}

function candidateFor(item, productId) {
  return (Array.isArray(item && item.candidates) ? item.candidates : [])
    .find(candidate => text(candidate.productId) === text(productId)) || null
}

function candidateSpecs(candidate) {
  return (Array.isArray(candidate && candidate.specs) ? candidate.specs : []).map(spec => ({
    specId: text(spec.specId),
    label: text(spec.label) || '未命名规格',
    stock: Math.max(0, Number(spec.stock || 0))
  })).filter(spec => spec.specId)
}

function recalculateItem(source) {
  const item = { ...source }
  const selectedProduct = candidateFor(item, item.productId)
  const specCandidates = selectedProduct ? candidateSpecs(selectedProduct) : []
  const selectedSpec = specCandidates.find(spec => spec.specId === text(item.specId)) || null
  item.productId = selectedProduct ? selectedProduct.productId : ''
  item.specId = selectedSpec ? selectedSpec.specId : ''
  item.specCandidates = specCandidates
  item.quantity = positiveInteger(item.quantity)
  item.unitCost = positiveMoney(item.unitCost)
  const issues = []
  if (!item.productId) issues.push(item.candidates.length ? '请选择正确的商品' : '未找到匹配商品')
  else if (!item.specId) issues.push('请选择正确的商品规格')
  if (item.quantity === null) issues.push('请输入大于 0 的整数数量')
  if (item.unitCost === null) issues.push('请输入大于 0 的进价')
  if (!item.productId) item.matchStatus = 'needs_product'
  else if (!item.specId) item.matchStatus = 'needs_spec'
  else if (item.quantity === null || item.unitCost === null) item.matchStatus = 'needs_values'
  else item.matchStatus = 'ready'
  item.requiresManual = item.matchStatus !== 'ready'
  item.issues = issues
  return item
}

function normalizeItem(source) {
  const recognized = source && source.recognized && typeof source.recognized === 'object'
    ? { ...source.recognized }
    : {}
  return recalculateItem({
    lineId: text(source && source.lineId),
    recognized,
    productId: text(source && source.productId),
    specId: text(source && source.specId),
    quantity: source && source.quantity !== undefined ? source.quantity : recognized.quantity,
    unitCost: source && source.unitCost !== undefined ? source.unitCost : recognized.unitCost,
    candidates: (Array.isArray(source && source.candidates) ? source.candidates : []).map(candidate => ({
      ...candidate,
      productId: text(candidate.productId),
      specs: candidateSpecs(candidate)
    }))
  })
}

function normalizeDraft(source) {
  return {
    draftId: text(source && source.draftId),
    items: (Array.isArray(source && source.items) ? source.items : []).map(normalizeItem)
  }
}

function updateItem(draft, lineId, updater) {
  const current = normalizeDraft(draft)
  return {
    ...current,
    items: current.items.map(item => item.lineId === text(lineId)
      ? recalculateItem(updater({ ...item }))
      : item)
  }
}

function selectProduct(draft, lineId, productId) {
  return updateItem(draft, lineId, item => {
    const candidate = candidateFor(item, productId)
    const specs = candidateSpecs(candidate)
    return {
      ...item,
      productId: candidate ? candidate.productId : '',
      specId: specs.length === 1 ? specs[0].specId : ''
    }
  })
}

function selectSpec(draft, lineId, specId) {
  return updateItem(draft, lineId, item => ({ ...item, specId: text(specId) }))
}

function updateQuantity(draft, lineId, value) {
  return updateItem(draft, lineId, item => ({ ...item, quantity: value }))
}

function updateUnitCost(draft, lineId, value) {
  return updateItem(draft, lineId, item => ({ ...item, unitCost: value }))
}

function removeItem(draft, lineId) {
  const current = normalizeDraft(draft)
  return { ...current, items: current.items.filter(item => item.lineId !== text(lineId)) }
}

function canConfirm(draft) {
  const current = normalizeDraft(draft)
  return current.items.length > 0 && current.items.every(item => item.matchStatus === 'ready')
}

function batchPayload(draft) {
  const current = normalizeDraft(draft)
  if (!current.draftId) throw new Error('批次编号缺失，请重新识别采购单')
  if (!canConfirm(current)) throw new Error('请先处理所有未完成项目')
  return {
    batchTransactionId: current.draftId,
    supplier: '',
    note: '',
    items: current.items.map(item => ({
      lineId: item.lineId,
      productId: item.productId,
      specId: item.specId,
      quantity: item.quantity,
      unitCost: item.unitCost
    }))
  }
}

function statusPresentation(item) {
  if (item.matchStatus === 'ready') return { label: '已匹配', tone: 'ready' }
  if (item.matchStatus === 'needs_product' && !item.candidates.length) return { label: '未找到商品', tone: 'error' }
  if (item.matchStatus === 'needs_product') return { label: '请选择商品', tone: 'warning' }
  if (item.matchStatus === 'needs_spec') return { label: '请选择规格', tone: 'warning' }
  return { label: '请补全信息', tone: 'error' }
}

function presentDraft(draft) {
  const current = normalizeDraft(draft)
  const items = current.items.map(item => {
    const selectedProduct = candidateFor(item, item.productId)
    const selectedSpec = item.specCandidates.find(spec => spec.specId === item.specId) || null
    const total = item.quantity !== null && item.unitCost !== null
      ? Math.round(item.quantity * item.unitCost * 100) / 100
      : null
    return {
      ...item,
      status: statusPresentation(item),
      selectedProductName: selectedProduct ? selectedProduct.name : '未选择商品',
      selectedSpecLabel: selectedSpec ? selectedSpec.label : '未选择规格',
      quantityInput: item.quantity === null ? '' : String(item.quantity),
      unitCostInput: item.unitCost === null ? '' : String(item.unitCost),
      lineTotalText: total === null ? '待补全' : money(total),
      recognizedText: [item.recognized.productName, item.recognized.productCode, item.recognized.spec]
        .map(text).filter(Boolean).join(' · ') || '未识别到商品特征'
    }
  })
  const totalCost = items.reduce((sum, item) => {
    if (item.quantity === null || item.unitCost === null) return sum
    return sum + item.quantity * item.unitCost
  }, 0)
  return {
    draft: current,
    items,
    empty: items.length === 0,
    canConfirm: canConfirm(current),
    totalCostText: money(Math.round(totalCost * 100) / 100)
  }
}

module.exports = {
  batchPayload,
  canConfirm,
  normalizeDraft,
  presentDraft,
  removeItem,
  selectProduct,
  selectSpec,
  updateQuantity,
  updateUnitCost
}
