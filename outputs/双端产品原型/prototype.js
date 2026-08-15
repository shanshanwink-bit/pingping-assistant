(() => {
  const modeButtons = [...document.querySelectorAll('[data-mode]')]
  const stages = {
    mobile: document.getElementById('mobile-stage'),
    admin: document.getElementById('admin-stage')
  }

  function switchMode(mode) {
    modeButtons.forEach(button => button.classList.toggle('active', button.dataset.mode === mode))
    Object.entries(stages).forEach(([key, stage]) => stage.classList.toggle('active', key === mode))
  }

  modeButtons.forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode)))
  document.querySelectorAll('[data-switch-to-admin]').forEach(button => button.addEventListener('click', () => switchMode('admin')))
  document.getElementById('open-admin-from-ledger').addEventListener('click', () => switchMode('admin'))

  const mobileScreens = [...document.querySelectorAll('[data-mobile-screen]')]
  const mobileTabs = [...document.querySelectorAll('.mobile-tabbar [data-mobile-target]')]
  const phoneContent = document.querySelector('.phone-content')

  function showMobileScreen(name) {
    mobileScreens.forEach(screen => screen.classList.toggle('active', screen.dataset.mobileScreen === name))
    mobileTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mobileTarget === name))
    phoneContent.scrollTop = 0
  }

  document.querySelectorAll('[data-mobile-target]').forEach(button => {
    button.addEventListener('click', () => showMobileScreen(button.dataset.mobileTarget))
  })

  document.querySelectorAll('[data-product-detail]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('detail-name').textContent = button.dataset.productDetail
      showMobileScreen('detail')
    })
  })

  document.querySelectorAll('[data-product-type]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-product-type]').forEach(item => item.classList.remove('active'))
      button.classList.add('active')
      const type = button.dataset.productType
      document.querySelectorAll('.mobile-product-row').forEach(row => {
        row.hidden = type !== 'all' && row.dataset.kind !== type
      })
    })
  })

  const mobileSearch = document.getElementById('mobile-product-search')
  mobileSearch.addEventListener('input', () => {
    const keyword = mobileSearch.value.trim().toLowerCase()
    document.querySelectorAll('.mobile-product-row').forEach(row => {
      row.hidden = Boolean(keyword) && !row.textContent.toLowerCase().includes(keyword)
    })
  })

  document.querySelectorAll('.period-tabs button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.period-tabs button').forEach(item => item.classList.remove('active'))
      button.classList.add('active')
      const data = {
        今日: ['今日经营盈利', '¥528.00'],
        昨日: ['昨日经营盈利', '¥442.00'],
        本月: ['本月经营盈利', '¥7,420.00']
      }[button.dataset.period]
      document.getElementById('ledger-period-label').textContent = data[0]
      document.getElementById('ledger-profit').textContent = data[1]
    })
  })

  const mobileSheet = document.getElementById('mobile-sheet')
  const mobileForm = document.getElementById('mobile-form')
  const mobileToast = document.getElementById('mobile-toast')
  const sheetTitle = document.getElementById('sheet-title')
  const sheetKicker = document.getElementById('sheet-kicker')
  const sheetSubmit = document.getElementById('sheet-submit')
  const previewLabel = document.getElementById('preview-label')
  const previewValue = document.getElementById('preview-value')
  const moneyLabel = document.getElementById('money-label')
  const paymentField = document.getElementById('payment-field')

  const formContent = {
    sale: {
      kicker: '快速记录', title: '登记卖货', submit: '确认卖货 · ¥129.00',
      previewLabel: '确认后库存', preview: '5 → 4 件', money: '单价', showPayment: true
    },
    purchase: {
      kicker: '新货到店', title: '登记拿货', submit: '确认拿货 · ¥580.00',
      previewLabel: '确认后库存', preview: '5 → 15 件', money: '单件进价', showPayment: false
    },
    stock: {
      kicker: '库存核对', title: '提交库存差异', submit: '提交差异待确认',
      previewLabel: '系统库存 / 实盘', preview: '5 / 4 件', money: '实际库存', showPayment: false
    },
    finance: {
      kicker: '其他收支', title: '快速记收支', submit: '确认记录 · ¥28.00',
      previewLabel: '计入账本', preview: '其他支出 ¥28', money: '金额', showPayment: false
    },
    create: {
      kicker: '快速建档', title: '新建商品', submit: '创建并继续拿货',
      previewLabel: '默认规格', preview: '通用 / 均码 / 0 件', money: '参考售价', showPayment: false
    }
  }

  function openMobileForm(type) {
    const content = formContent[type] || formContent.sale
    mobileForm.dataset.formType = type
    sheetKicker.textContent = content.kicker
    sheetTitle.textContent = content.title
    sheetSubmit.textContent = content.submit
    previewLabel.textContent = content.previewLabel
    previewValue.textContent = content.preview
    moneyLabel.textContent = content.money
    paymentField.hidden = !content.showPayment
    mobileSheet.classList.add('open')
    mobileSheet.setAttribute('aria-hidden', 'false')
  }

  function closeMobileForm() {
    mobileSheet.classList.remove('open')
    mobileSheet.setAttribute('aria-hidden', 'true')
  }

  function showMobileToast(message) {
    mobileToast.textContent = message
    mobileToast.classList.add('show')
    window.setTimeout(() => mobileToast.classList.remove('show'), 1800)
  }

  document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', () => openMobileForm(button.dataset.openForm)))
  document.querySelector('[data-mobile-action="sale"]').addEventListener('click', () => openMobileForm('sale'))
  document.getElementById('close-sheet').addEventListener('click', closeMobileForm)
  document.querySelector('.sheet-scrim').addEventListener('click', closeMobileForm)
  mobileForm.addEventListener('submit', event => {
    event.preventDefault()
    const label = formContent[mobileForm.dataset.formType]?.title || '记录'
    closeMobileForm()
    showMobileToast(`${label}成功`)
  })

  const adminPages = [...document.querySelectorAll('[data-admin-page]')]
  const adminNavButtons = [...document.querySelectorAll('.admin-nav [data-admin-target]')]

  function showAdminPage(name) {
    adminPages.forEach(page => page.classList.toggle('active', page.dataset.adminPage === name))
    adminNavButtons.forEach(button => button.classList.toggle('active', button.dataset.adminTarget === name))
    document.querySelector('.admin-workspace').scrollTop = 0
  }

  document.querySelectorAll('[data-admin-target]').forEach(button => {
    button.addEventListener('click', () => {
      switchMode('admin')
      showAdminPage(button.dataset.adminTarget)
    })
  })

  const adminProductSearch = document.getElementById('admin-product-search')
  const adminProductKind = document.getElementById('admin-product-kind')

  function filterAdminProducts() {
    const keyword = adminProductSearch.value.trim().toLowerCase()
    const kind = adminProductKind.value
    document.querySelectorAll('.product-table tbody tr').forEach(row => {
      const matchesKeyword = !keyword || row.dataset.search.toLowerCase().includes(keyword)
      const matchesKind = kind === 'all' || row.dataset.kind === kind
      row.hidden = !(matchesKeyword && matchesKind)
    })
  }

  adminProductSearch.addEventListener('input', filterAdminProducts)
  adminProductKind.addEventListener('change', filterAdminProducts)

  const productCheckboxes = [...document.querySelectorAll('.product-checkbox')]
  const selectAllProducts = document.getElementById('select-all-products')
  const bulkBar = document.getElementById('bulk-bar')
  const selectedCount = document.getElementById('selected-count')

  function syncProductSelection() {
    const count = productCheckboxes.filter(checkbox => checkbox.checked).length
    selectedCount.textContent = count
    bulkBar.classList.toggle('visible', count > 0)
    selectAllProducts.checked = count === productCheckboxes.length
    selectAllProducts.indeterminate = count > 0 && count < productCheckboxes.length
  }

  productCheckboxes.forEach(checkbox => checkbox.addEventListener('change', syncProductSelection))
  selectAllProducts.addEventListener('change', () => {
    productCheckboxes.forEach(checkbox => { checkbox.checked = selectAllProducts.checked })
    syncProductSelection()
  })

  const adminDrawer = document.getElementById('admin-drawer')
  const drawerForm = document.getElementById('drawer-form')
  const drawerTitle = document.getElementById('drawer-title')
  const drawerProductName = document.getElementById('drawer-product-name')

  function openDrawer(name) {
    const isNew = name === 'new'
    drawerTitle.textContent = isNew ? '新建商品' : `编辑${name}`
    drawerProductName.value = isNew ? '' : name
    adminDrawer.classList.add('open')
    adminDrawer.setAttribute('aria-hidden', 'false')
  }

  function closeDrawer() {
    adminDrawer.classList.remove('open')
    adminDrawer.setAttribute('aria-hidden', 'true')
  }

  document.querySelectorAll('[data-open-drawer]').forEach(button => button.addEventListener('click', () => openDrawer(button.dataset.openDrawer)))
  document.getElementById('close-drawer').addEventListener('click', closeDrawer)
  document.getElementById('cancel-drawer').addEventListener('click', closeDrawer)
  drawerForm.addEventListener('submit', event => {
    event.preventDefault()
    closeDrawer()
    showAdminToast('商品资料已保存')
  })

  const adminModal = document.getElementById('admin-modal')
  const adminModalForm = document.getElementById('admin-modal-form')
  const modalTitle = document.getElementById('modal-title')
  const modalName = document.getElementById('modal-name')

  function openAdminModal(type) {
    const isAdjust = type === 'adjust'
    modalTitle.textContent = isAdjust ? '库存修正' : '创建盘点单'
    modalName.value = isAdjust ? '针织开衫 · 杏色 / M' : '8月中旬服装盘点'
    adminModal.dataset.modalType = type
    adminModal.classList.add('open')
    adminModal.setAttribute('aria-hidden', 'false')
  }

  function closeAdminModal() {
    adminModal.classList.remove('open')
    adminModal.setAttribute('aria-hidden', 'true')
  }

  document.querySelectorAll('[data-modal]').forEach(button => button.addEventListener('click', () => openAdminModal(button.dataset.modal)))
  document.getElementById('close-modal').addEventListener('click', closeAdminModal)
  document.getElementById('cancel-modal').addEventListener('click', closeAdminModal)
  document.querySelector('.modal-scrim').addEventListener('click', closeAdminModal)
  adminModalForm.addEventListener('submit', event => {
    event.preventDefault()
    const message = adminModal.dataset.modalType === 'adjust' ? '库存修正已提交' : '盘点单已创建'
    closeAdminModal()
    showAdminToast(message)
  })

  const adminToast = document.getElementById('admin-toast')
  let adminToastTimer

  function showAdminToast(message) {
    window.clearTimeout(adminToastTimer)
    adminToast.textContent = message
    adminToast.classList.add('show')
    adminToastTimer = window.setTimeout(() => adminToast.classList.remove('show'), 1900)
  }

  document.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => showAdminToast(button.dataset.toast)))
})()
