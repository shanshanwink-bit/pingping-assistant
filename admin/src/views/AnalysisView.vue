<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../services/api'
import { canAccess } from '../utils/access'
import { businessDate, shiftBusinessDate } from '../utils/businessDate'
import { downloadCSV } from '../utils/csv'
import { money } from '../utils/format'

const props = defineProps({ currentUser: Object })
const emit = defineEmits(['toast'])
const filters = ref({ from: shiftBusinessDate(-29), to: businessDate(), businessType: '全部' })
const data = ref({ trend: [], products: [], payments: [] })
const loading = ref(true)
const error = ref('')
const canExport = computed(() => canAccess(props.currentUser, 'reports.export'))
const maxTrend = computed(() => Math.max(1, ...(data.value.trend || []).flatMap(item => [Math.abs(item.revenue), Math.abs(item.profit)])))
const maxProduct = computed(() => Math.max(1, ...(data.value.products || []).map(item => item.revenue)))
const totalPayments = computed(() => (data.value.payments || []).reduce((sum, item) => sum + item.amount, 0))

async function load() {
  loading.value = true
  error.value = ''
  try { data.value = await api.analysis(filters.value) } catch (err) { error.value = err.message } finally { loading.value = false }
}
function exportReport() {
  const rows = [
    ['经营分析', `${filters.value.from} 至 ${filters.value.to}`],
    ['销售收入', data.value.revenue],
    ...(data.value.canViewCost ? [['已售商品成本', data.value.cost]] : []),
    ['商品毛利', data.value.grossProfit], ['其他收入', data.value.otherIncome],
    ['其他支出', data.value.otherExpense], ['经营盈利', data.value.operatingProfit],
    ['采购现金支出', data.value.purchaseExpense], [],
    ['商品', '销量', '收入', '毛利'],
    ...(data.value.products || []).map(item => [item.name, item.quantity, item.revenue, item.profit])
  ]
  downloadCSV('经营分析.csv', rows)
  emit('toast', '经营分析已导出')
}
onMounted(load)
</script>

<template>
  <section class="business-page">
    <div class="page-heading"><div><h2>经营分析</h2><p>统一读取小程序真实经营数据；采购支出只作为现金流展示</p></div><div class="heading-actions"><button v-if="canExport" class="secondary" @click="exportReport"><span class="material-symbols-outlined">download</span>导出报表</button></div></div>
    <article class="analysis-filter"><label><span>开始日期</span><input v-model="filters.from" type="date" /></label><label><span>结束日期</span><input v-model="filters.to" type="date" /></label><label><span>业务类型</span><select v-model="filters.businessType"><option>全部</option><option>服装</option><option>化妆品</option></select></label><button class="primary" @click="load">应用筛选</button></article>
    <div v-if="error" class="inline-error">{{ error }}<button @click="load">重试</button></div>
    <div class="metrics analysis-metrics">
      <article><span>销售收入</span><strong>{{ money(data.revenue) }}</strong><small>{{ data.salesCount || 0 }} 笔 / {{ data.soldQuantity || 0 }} 件</small></article>
      <article><span>已售商品成本</span><strong>{{ data.canViewCost ? money(data.cost) : '无权限' }}</strong><small>{{ data.missingCostSales ? `${data.missingCostSales} 笔成本缺失` : '仅统计可靠销售成本' }}</small></article>
      <article><span>商品毛利</span><strong>{{ money(data.grossProfit) }}</strong><small>可靠成本销售毛利率 {{ Number(data.grossMargin || 0).toFixed(1) }}%</small></article>
      <article><span>经营盈利</span><strong>{{ money(data.operatingProfit) }}</strong><small>采购支出 {{ money(data.purchaseExpense) }}，未重复扣减</small></article>
      <article><span>平均每单</span><strong>{{ money(data.averageOrder) }}</strong><small>有效销售口径</small></article>
    </div>
    <div class="analysis-grid">
      <article class="data-card chart-card"><div class="card-title"><h3>每日销售与经营盈利</h3><p>{{ filters.from }} 至 {{ filters.to }}</p></div><div v-if="data.trend?.length" class="trend-chart"><div v-for="point in data.trend" :key="point.date" class="trend-column"><div class="trend-value">{{ money(point.revenue).replace('.00','') }}</div><div class="trend-bars"><i class="revenue" :style="{height:`${Math.max(8,Math.abs(point.revenue)/maxTrend*180)}px`}"></i><i class="profit" :class="{negative:point.profit<0}" :style="{height:`${Math.max(4,Math.abs(point.profit)/maxTrend*180)}px`}"></i></div><span>{{ point.date.slice(5) }}</span></div></div><div v-else class="content-state">当前范围暂无经营记录</div></article>
      <article class="data-card"><div class="card-title"><h3>收款方式构成</h3><p>有效销售金额</p></div><div class="payment-list"><div v-for="item in data.payments" :key="item.name"><p><b>{{ item.name }}</b><span>{{ money(item.amount) }} · {{ totalPayments ? Math.round(item.amount/totalPayments*100) : 0 }}%</span></p><div><i :style="{width:`${totalPayments?item.amount/totalPayments*100:0}%`}"></i></div></div><div v-if="!data.payments?.length" class="content-state">暂无收款数据</div></div></article>
    </div>
    <article class="data-card"><div class="card-title"><h3>商品经营表现</h3><p>缺少真实成本的销售不会伪造毛利</p></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>排名</th><th>商品</th><th class="right">销量</th><th class="right">销售收入</th><th class="right">商品毛利</th><th>收入贡献</th></tr></thead><tbody><tr v-for="(item,index) in data.products" :key="item.name"><td class="mono">{{ index+1 }}</td><td><b>{{ item.name }}</b></td><td class="right mono">{{ item.quantity }}</td><td class="right mono">{{ money(item.revenue) }}</td><td class="right mono" :class="{error:item.profit<0}">{{ money(item.profit) }}</td><td><div class="mini-progress"><i :style="{width:`${item.revenue/maxProduct*100}%`}"></i></div></td></tr><tr v-if="!data.products?.length&&!loading"><td colspan="6" class="empty-result">暂无商品表现数据</td></tr></tbody></table></div></article>
    <div v-if="loading" class="loading-line"></div>
  </section>
</template>
