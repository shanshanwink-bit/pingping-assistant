const SUMMARY_SPEC_PATTERN = /^(全部规格|汇总|聚合|SKU_SUMMARY)$/i

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function isSummarySpec(spec) {
  return SUMMARY_SPEC_PATTERN.test(text(spec && spec.color)) ||
    SUMMARY_SPEC_PATTERN.test(text(spec && spec.size))
}

function visibleSpecs(specs) {
  const items = Array.isArray(specs) ? specs : []
  const summaries = items.filter(isSummarySpec)
  const stocked = summaries.filter(spec => Number(spec && spec.stock || 0) > 0)
  if (summaries.length <= 1 || stocked.length !== 1) return items
  const active = stocked[0]
  return items.filter(spec => !isSummarySpec(spec) || spec === active || Number(spec && spec.stock || 0) > 0)
}

module.exports = { isSummarySpec, visibleSpecs }
