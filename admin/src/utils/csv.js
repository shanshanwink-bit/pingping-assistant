export const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`

export const csvText = rows => `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`

export function downloadCSV(filename, rows) {
  const blob = new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
