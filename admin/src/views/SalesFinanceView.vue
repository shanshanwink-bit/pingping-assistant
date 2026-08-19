<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../services/api'
import { money } from '../utils/format'

const loading = ref(true)
const error = ref('')
const sales = ref([])
const entries = ref([])
const purchases = ref([])
const summary = ref({})
const source = ref('')
const canViewCost = ref(false)
const canViewProfit = ref(false)
const tab = ref('sales')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.salesFinance()
    sales.value = data.sales || []
    entries.value = data.entries || []
    purchases.value = data.purchases || []
    summary.value = data.summary || {}
    source.value = data.source || ''
    canViewCost.value = Boolean(data.canViewCost)
    canViewProfit.value = Boolean(data.canViewProfit)
  } catch (err) { error.value = err.message } finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <section class="business-page">
    <div class="page-heading"><div><h2>销售与收支</h2><p>经营记录只读查看；高频卖货、拿货和记一笔请使用微信小程序</p></div><span class="audit-lock"><span class="material-symbols-outlined">database</span>当前来源：{{ source || '正在读取' }}</span></div>
    <div class="metrics business-metrics five">
      <article><span>销售收入</span><strong>{{ money(summary.revenue) }}</strong><small>{{ summary.salesCount || 0 }} 笔有效销售</small></article>
      <article><span>商品毛利</span><strong>{{ canViewProfit ? money(summary.grossProfit) : '无权限' }}</strong><small>{{ summary.missingCostSales ? `${summary.missingCostSales} 笔成本缺失` : '只统计可靠成本' }}</small></article>
      <article><span>其他收入</span><strong>{{ canViewProfit ? money(summary.otherIncome) : '无权限' }}</strong><small>小程序记一笔</small></article>
      <article><span>其他支出</span><strong>{{ canViewProfit ? money(summary.otherExpense) : '无权限' }}</strong><small>小程序记一笔</small></article>
      <article><span>经营盈利</span><strong>{{ canViewProfit ? money(summary.operatingProfit) : '无权限' }}</strong><small>采购支出不重复扣减</small></article>
    </div>
    <div v-if="error" class="inline-error"><span class="material-symbols-outlined">error</span>{{ error }}<button @click="load">重试</button></div>
    <div class="segmented page-tabs">
      <button :class="{active:tab==='sales'}" @click="tab='sales'">卖货记录</button>
      <button v-if="canViewProfit" :class="{active:tab==='entries'}" @click="tab='entries'">其他收支</button>
      <button v-if="canViewCost" :class="{active:tab==='purchases'}" @click="tab='purchases'">采购支出</button>
    </div>
    <article class="data-card">
      <div v-if="tab==='sales'" class="data-table-wrap"><table class="data-table"><thead><tr><th>时间 / 单号</th><th>商品 / 规格</th><th class="right">数量</th><th class="right">金额</th><th class="right">已售成本</th><th class="right">商品毛利</th><th>收款方式</th><th>操作人</th><th>来源</th></tr></thead><tbody>
        <tr v-for="item in sales" :key="item.recordId"><td><span class="mono">{{ item.orderNo }}</span><small>{{ item.createdAt }}</small></td><td><b>{{ item.productName }}</b><small>{{ item.businessType }}<template v-if="item.specText"> · {{ item.specText }}</template></small></td><td class="right mono">{{ item.quantity }}</td><td class="right mono">{{ money(item.amount) }}</td><td class="right mono">{{ !canViewCost ? '无权限' : item.hasCost ? money(item.costAmount) : '成本缺失' }}</td><td class="right mono">{{ !canViewProfit ? '无权限' : item.hasCost ? money(item.profit) : '不计盈利' }}</td><td>{{ item.paymentMethod || '未记录' }}</td><td>{{ item.operatorName || '—' }}</td><td>{{ item.source }}</td></tr>
        <tr v-if="!sales.length&&!loading"><td colspan="9" class="empty-result">暂无卖货记录</td></tr>
      </tbody></table></div>
      <div v-else-if="tab==='entries'" class="data-table-wrap"><table class="data-table"><thead><tr><th>业务日期</th><th>类型</th><th>业务归属</th><th class="right">金额</th><th>备注</th><th>操作人</th><th>来源</th></tr></thead><tbody>
        <tr v-for="item in entries" :key="item.recordId"><td class="mono">{{ item.occurredOn }}</td><td><span class="status-pill" :class="item.entryType==='income'?'success':'warning'">{{ item.entryType==='income'?'其他收入':'其他支出' }}</span></td><td>{{ item.businessType }}</td><td class="right mono" :class="item.entryType==='expense'?'error':'positive'">{{ item.entryType==='expense'?'-':'+' }}{{ money(item.amount) }}</td><td>{{ item.note || '—' }}</td><td>{{ item.operatorName || '—' }}</td><td>{{ item.source }}</td></tr>
        <tr v-if="!entries.length&&!loading"><td colspan="7" class="empty-result">暂无其他收支</td></tr>
      </tbody></table></div>
      <div v-else class="data-table-wrap"><table class="data-table"><thead><tr><th>时间 / 编号</th><th>商品 / 规格</th><th class="right">数量</th><th class="right">采购支出</th><th>供应商</th><th>备注</th><th>操作人</th><th>来源</th></tr></thead><tbody>
        <tr v-for="item in purchases" :key="item.recordId"><td><span class="mono">{{ item.recordId }}</span><small>{{ item.createdAt }}</small></td><td><b>{{ item.productName }}</b><small>{{ item.businessType }}<template v-if="item.specText"> · {{ item.specText }}</template></small></td><td class="right mono">{{ item.quantity }}</td><td class="right mono error">{{ money(item.totalCost) }}</td><td>{{ item.supplier || '未记录' }}</td><td>{{ item.note || '—' }}</td><td>{{ item.operatorName || '—' }}</td><td>{{ item.source }}</td></tr>
        <tr v-if="!purchases.length&&!loading"><td colspan="8" class="empty-result">暂无采购支出</td></tr>
      </tbody></table></div>
    </article>
    <div v-if="loading" class="loading-line"></div>
  </section>
</template>
