<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../services/api'
import { money } from '../utils/format'

const loading=ref(true),error=ref(''),items=ref([]),operations=ref([]),canViewCost=ref(false),tab=ref('stock'),query=ref('')
const filtered=computed(()=>items.value.filter(item=>!query.value||`${item.name} ${item.code}`.toLowerCase().includes(query.value.toLowerCase())))
const metrics=computed(()=>({
  quantity:items.value.reduce((sum,item)=>sum+item.stock,0),
  cost:items.value.reduce((sum,item)=>sum+item.stock*item.costPrice,0),
  low:items.value.filter(item=>item.stock>0&&item.stock<=item.lowStockThreshold).length,
  empty:items.value.filter(item=>item.stock===0).length
}))
async function load(){loading.value=true;error.value='';try{const data=await api.inventory();items.value=data.items;operations.value=data.operations;canViewCost.value=data.canViewCost}catch(err){error.value=err.message}finally{loading.value=false}}
onMounted(load)
</script>
<template>
  <section class="business-page">
    <div class="page-heading"><div><h2>库存中心</h2><p>用于查看和核对商品聚合库存，不代表颜色、尺码等具体规格库存</p></div><div class="segmented"><button :class="{active:tab==='stock'}" @click="tab='stock'">实时库存</button><button :class="{active:tab==='ledger'}" @click="tab='ledger'">后台库存流水</button></div></div>
    <div class="inline-notice"><span class="notice-mark" aria-hidden="true">i</span>规格库存请通过小程序经营流程维护。</div>
    <div class="metrics business-metrics"><article><span>聚合库存总量</span><strong>{{metrics.quantity}}</strong><small>件在库</small></article><article><span>库存成本</span><strong>{{canViewCost?money(metrics.cost):'无权限'}}</strong><small>按后台商品成本价</small></article><article><span>低库存</span><strong>{{metrics.low}}</strong><small>按商品独立阈值</small></article><article class="danger-metric"><span>缺货商品</span><strong>{{metrics.empty}}</strong><small>聚合库存为 0</small></article></div>
    <div v-if="error" class="inline-error"><span class="material-symbols-outlined">error</span>{{error}}<button @click="load">重试</button></div>
    <article v-if="tab==='stock'" class="data-card"><div class="filterbar"><div class="filters"><label><span class="material-symbols-outlined">search</span><input v-model="query" placeholder="搜索商品/编号" /></label></div><span class="muted">{{filtered.length}} 个商品</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>商品</th><th>编号</th><th>分类</th><th>货位</th><th class="right">聚合库存</th><th class="right">阈值</th><th class="right">库存成本</th><th>库存状态</th></tr></thead><tbody>
      <tr v-for="item in filtered" :key="item.id"><td><b>{{item.name}}</b></td><td class="mono muted">{{item.code}}</td><td>{{item.businessType}} · {{item.category}}</td><td>{{item.location||'未设置'}}</td><td class="right mono">{{item.stock}}</td><td class="right mono">{{item.lowStockThreshold}}</td><td class="right mono">{{canViewCost?money(item.stock*item.costPrice):'无权限'}}</td><td><span class="status-pill" :class="item.stock===0?'danger':item.stock<=item.lowStockThreshold?'warning':'success'">{{item.stock===0?'缺货':item.stock<=item.lowStockThreshold?'库存偏低':'正常'}}</span></td></tr>
      <tr v-if="!filtered.length&&!loading"><td colspan="8" class="empty-result">暂无库存商品</td></tr>
    </tbody></table></div></article>
    <article v-else class="data-card"><div class="card-title"><h3>后台聚合库存流水</h3><p>仅展示后台历史聚合库存变更，不等同于小程序规格流水</p></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>商品</th><th>来源</th><th class="right">变更前</th><th class="right">变化量</th><th class="right">变更后</th><th>原因</th><th>操作人</th></tr></thead><tbody>
      <tr v-for="item in operations" :key="item.id"><td class="mono muted">{{item.createdAt}}</td><td><b>{{item.productName}}</b></td><td>{{({adjust:'库存修正',sale:'后台销售出库',reversal:'后台作废回库',stocktake:'盘点'})[item.operationType]||item.operationType}}</td><td class="right mono">{{item.beforeStock}}</td><td class="right mono" :class="item.quantityChange<0?'error':'positive'">{{item.quantityChange>0?'+':''}}{{item.quantityChange}}</td><td class="right mono">{{item.afterStock}}</td><td>{{item.reason}}</td><td>{{item.operatorName}}</td></tr>
      <tr v-if="!operations.length&&!loading"><td colspan="8" class="empty-result">暂无后台库存流水</td></tr>
    </tbody></table></div></article>
    <div v-if="loading" class="loading-line"></div>
  </section>
</template>
