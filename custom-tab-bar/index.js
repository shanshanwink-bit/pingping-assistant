Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/index', text: '首页', icon: '/assets/icons/tab-home.svg', activeIcon: '/assets/icons/tab-home-active.svg' },
      { pagePath: '/pages/inventory/index', text: '商品', icon: '/assets/icons/tab-sales.svg', activeIcon: '/assets/icons/tab-sales-active.svg' },
      { pagePath: '/pages/quick-action/index', text: '记一笔', icon: '/assets/icons/brand-water-fashion-beauty.svg', activeIcon: '/assets/icons/brand-water-fashion-beauty.svg', main: true },
      { pagePath: '/pages/profit/index', text: '账本', icon: '/assets/icons/tab-profit.svg', activeIcon: '/assets/icons/tab-profit-active.svg' },
      { pagePath: '/pages/profile/index', text: '我的', icon: '/assets/icons/tab-profile.svg', activeIcon: '/assets/icons/tab-profile-active.svg' }
    ]
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item || index === this.data.selected) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
