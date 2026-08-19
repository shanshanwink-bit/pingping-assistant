function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function roundMoney(value) {
  return Math.round(safeNumber(value) * 100) / 100
}

function formatMoney(value) {
  const parts = Math.abs(roundMoney(value)).toFixed(2).split('.')
  return `¥${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1]}`
}

function formatInteger(value) {
  return String(Math.round(safeNumber(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function validDateKey(value) {
  const key = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : ''
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

function getLedgerPeriodRange(period, now) {
  const current = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate())
  const target = ['today', 'week', 'month'].includes(period) ? period : 'today'
  let start = today
  if (target === 'week') start = addDays(today, -((today.getDay() + 6) % 7))
  if (target === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1)
  const startKey = localDateKey(start)
  const endKey = localDateKey(today)
  const labelMap = { today: '今天', week: '本周', month: '本月' }
  return {
    period: target,
    start: startKey,
    end: endKey,
    label: labelMap[target],
    rangeText: startKey === endKey
      ? startKey.replace(/-/g, '.')
      : `${startKey.replace(/-/g, '.')} - ${endKey.replace(/-/g, '.')}`
  }
}

module.exports = {
  addDays,
  formatInteger,
  formatMoney,
  getLedgerPeriodRange,
  localDateKey,
  roundMoney,
  validDateKey
}
