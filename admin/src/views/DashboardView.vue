<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../services/api'
import { canAccess } from '../utils/access'
import { downloadCSV } from '../utils/csv'
import { money } from '../utils/format'

const props = defineProps({ currentUser: Object })
const emit = defineEmits(['toast', 'updated', 'navigate'])
const loading = ref(true)
const error = ref('')
const dashboard = ref({ trend: [] })
const products = ref([])
const canViewCost = ref(false)
const canViewProfit = ref(false)
const canExport = computed(() => canAccess(props.currentUser, 'reports.export'))
const canViewInventory = computed(() => canAccess(props.currentUser, 'inventory.view'))
const canViewProducts = computed(() => canAccess(props.currentUser, 'products.view'))
const todayLabel = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
}).format(new Date())

const trendBars = computed(() => {
  const values = (dashboard.value.trend || []).map(value => Number(value) || 0)
  const max = Math.max(...values.map(Math.abs), 1)
  return values.map((value, index) => {
    const date = new Date(Date.now() - (values.length - 1 - index) * 86400000)
    return {
      height: Math.max(18, Math.round(Math.abs(value) / max * 190)),
      negative: value < 0,
      label: index === values.length - 1 ? '今日' : `${date.getMonth() + 1}/${date.getDate()}`
    }
  })
})
const stockWarnings = computed(() => products.value
  .filter(product => Number(product.stock || 0) <= Number(product.lowStockThreshold || 0))
  .sort((left, right) => Number(left.stock || 0) - Number(right.stock || 0)).slice(0, 3))
const productOverview = computed(() => products.value.slice(0, 6))

async function load() {
  loading.value = true
  error.value = ''
  const [dashboardResult, productsResult] = await Promise.allSettled([api.dashboard(), api.products()])
  if (dashboardResult.status === 'rejected') error.value = dashboardResult.reason.message
  else {
    dashboard.value = dashboardResult.value
    canViewCost.value = Boolean(dashboard.value.canViewCost)
    canViewProfit.value = Boolean(dashboard.value.canViewProfit)
    emit('updated', dashboard.value.updatedAt)
  }
  if (productsResult.status === 'fulfilled') products.value = productsResult.value.items || []
  loading.value = false
}

function exportDaily() {
  const rows = [
    ['指标', '数值'], ['今日销售', dashboard.value.salesAmount || 0],
    ...(canViewProfit.value ? [['经营盈利', dashboard.value.profit || 0]] : []),
    ...(canViewCost.value ? [['已售商品成本', dashboard.value.soldCost || 0]] : []),
    ['售出数量', dashboard.value.soldQuantity || 0], ['销售笔数', dashboard.value.salesCount || 0],
    ['库存件数', dashboard.value.inventoryQuantity || 0],
    ...(canViewCost.value ? [['库存成本', dashboard.value.inventoryCost || 0]] : [])
  ]
  downloadCSV('经营日报.csv', rows)
  emit('toast', '经营日报已导出')
}

onMounted(load)
</script>

<template>
  <section class="dashboard-page proposal-admin-dashboard">
    <div class="page-heading bordered proposal-dashboard-heading">
      <div><h2>经营概览</h2><p>{{ todayLabel }} · 当前真实经营数据</p></div>
      <div class="heading-actions">
        <button v-if="canExport" class="secondary" @click="exportDaily"><span class="material-symbols-outlined">download</span>导出日报</button>
        <button v-if="canViewInventory" class="primary" @click="emit('navigate', 'inventory')">查看库存<span class="material-symbols-outlined">arrow_forward</span></button>
      </div>
    </div>
    <div v-if="error" class="inline-error"><span class="material-symbols-outlined">cloud_off</span>{{ error }}<button @click="load">重新加载</button></div>
    <div class="proposal-kpi-grid">
      <article><span>今日盈利</span><strong class="accent">{{ canViewProfit ? money(dashboard.profit) : '无权限' }}</strong><small>真实销售毛利 + 其他收入 - 其他支出</small></article>
      <article><span>今日销售</span><strong>{{ money(dashboard.salesAmount) }}</strong><small>{{ dashboard.salesCount || 0 }} 笔销售</small></article>
      <article><span>今日已售商品成本</span><strong>{{ canViewCost ? money(dashboard.soldCost) : '无权限' }}</strong><small>{{ dashboard.missingCostSales ? `${dashboard.missingCostSales} 笔销售成本缺失` : '仅统计可靠销售成本' }}</small></article>
      <article><span>今日销售单数</span><strong>{{ dashboard.salesCount || 0 }}</strong><small>售出 {{ dashboard.soldQuantity || 0 }} 件</small></article>
    </div>
    <div class="proposal-dashboard-grid">
      <article class="proposal-admin-card proposal-trend-card">
        <header><h3>近 7 天盈利趋势</h3><span>每日经营盈利</span></header>
        <div v-if="canViewProfit" class="chart"><div class="y-axis"><span>高</span><span></span><span></span><span>低</span></div><div class="chart-area"><div class="grid-lines"><i v-for="n in 5" :key="n"></i></div><div v-for="(bar, index) in trendBars" :key="index" class="bar-wrap"><div class="bar" :class="{negative:bar.negative}" :style="{ height: `${bar.height}px` }"></div><span :class="{ today: index === trendBars.length - 1 }">{{ bar.label }}</span></div></div></div>
        <div v-else class="content-state">当前账号无盈利数据权限</div>
      </article>
      <article class="proposal-admin-card proposal-warning-card">
        <header><h3>库存预警</h3><button v-if="canViewInventory" @click="emit('navigate', 'inventory')">更多 ›</button></header>
        <div v-if="stockWarnings.length" class="proposal-warning-list">
          <div v-for="product in stockWarnings" :key="product.id"><span class="proposal-admin-product-icon material-symbols-outlined">inventory_2</span><p><b>{{ product.name }}</b><small>{{ product.category || '未分类' }}</small></p><em>{{ product.stock===0?'缺货':`库存偏低 · ${product.stock} 件` }}</em></div>
        </div>
        <div v-else-if="!loading" class="content-state">当前没有库存预警</div>
      </article>
    </div>
    <article class="proposal-admin-card proposal-product-overview">
      <header><h3>商品概览</h3><button v-if="canViewProducts" @click="emit('navigate', 'products')">更多 ›</button></header>
      <div class="table-scroll"><table><thead><tr><th>商品</th><th>分类</th><th class="right">聚合库存</th><th class="right">库存金额</th><th class="right">售价</th><th class="right">操作</th></tr></thead><tbody>
        <tr v-for="product in productOverview" :key="product.id"><td><div class="proposal-product-name"><span class="proposal-admin-product-icon material-symbols-outlined">inventory_2</span><b>{{ product.name }}</b></div></td><td class="muted">{{ product.category || '未分类' }}</td><td class="right mono">{{ product.stock }}</td><td class="right mono">{{ canViewCost ? money(Number(product.costPrice || 0) * Number(product.stock || 0)) : '无权限' }}</td><td class="right mono">{{ money(product.price) }}</td><td class="right"><button v-if="canViewProducts" class="table-link" @click="emit('navigate', 'products')">查看</button><span v-else>—</span></td></tr>
        <tr v-if="!productOverview.length && !loading"><td colspan="6" class="empty-result">暂无商品数据</td></tr>
      </tbody></table></div>
    </article>
    <div v-if="loading" class="loading-line"></div>
  </section>
</template>
