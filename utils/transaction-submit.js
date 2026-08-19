function createTransactionSubmitter(dependencies) {
  const deps = dependencies || {}
  const inFlight = new Map()

  function submit(mode, payload) {
    const key = `${mode}:${payload && payload.transactionId || ''}`
    if (inFlight.has(key)) return inFlight.get(key)
    const commit = mode === 'purchase' ? deps.commitPurchase : deps.commitSale
    if (typeof commit !== 'function') return Promise.reject(new Error('交易接口不可用'))
    const promise = Promise.resolve()
      .then(() => commit(payload))
      .then(result => {
        if (!result || !result.state || !result.transaction) throw new Error('服务器交易响应不完整')
        if (typeof deps.persist === 'function') deps.persist(result.state)
        return result
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }

  return { submit, isSubmitting: (mode, transactionId) => inFlight.has(`${mode}:${transactionId}`) }
}

module.exports = { createTransactionSubmitter }
