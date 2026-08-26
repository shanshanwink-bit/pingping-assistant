<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../services/api'
import { money } from '../utils/format'
import { canAccess } from '../utils/access'
import { downloadCSV } from '../utils/csv'
import { isProductActiveStatus, productStatusMatchesFilter, toggledProductStatus } from '../utils/productStatus'

const props = defineProps({ currentUser: Object })
const emit = defineEmits(['toast'])
const loading=ref(true),saving=ref(false),error=ref(''),products=ref([]),canViewCost=ref(false),query=ref(''),businessType=ref(''),stockStatus=ref(''),statusFilter=ref('active'),editing=ref(null),deletingId=ref(null),deletionEligibility=ref({}),pendingConfirm=ref(null)
const imageInput=ref(null),selectedImage=ref(null),imagePreview=ref('')
const blank=()=>({name:'',code:'',itemNumber:'',businessType:'服装',category:'',specCount:1,costPrice:0,lowStockThreshold:5,location:'',price:0,status:'销售中',image:''})
const payload=p=>Object.fromEntries(Object.keys(blank()).filter(key=>key!=='code').map(key=>[key,key==='itemNumber'?String(p[key]||'').trim():p[key]]))
const form=ref(blank())
const canEdit=computed(()=>canAccess(props.currentUser,'products.edit'))
const canExport=computed(()=>canAccess(props.currentUser,'products.export'))
const canDeleteProducts=computed(()=>props.currentUser?.role==='owner')
const editingDeletionEligibility=computed(()=>editing.value?.id?deletionEligibility.value[editing.value.id]:null)
const filteredProducts=computed(()=>products.value.filter(p=>{const k=query.value.trim().toLowerCase();return(!k||`${p.name} ${p.itemNumber||''}`.toLowerCase().includes(k))&&(!businessType.value||p.businessType===businessType.value)&&(!stockStatus.value||(stockStatus.value==='有货'?p.stock>0:p.stock===0))&&productStatusMatchesFilter(p.status,statusFilter.value)}))
const metrics=computed(()=>({active:products.value.filter(p=>isProductActiveStatus(p.status)).length,clothing:products.value.filter(p=>p.businessType==='服装').length,cosmetics:products.value.filter(p=>p.businessType==='化妆品').length,incomplete:products.value.filter(p=>!p.image||!p.category).length}))
async function refreshDeletionEligibility(id){if(!canDeleteProducts.value)return;try{const result=await api.productDeletionEligibility(id);deletionEligibility.value={...deletionEligibility.value,[id]:result}}catch(e){deletionEligibility.value={...deletionEligibility.value,[id]:{canDelete:false,reasons:e.reasons||[]}}}}
async function loadDeletionEligibility(){if(!canDeleteProducts.value){deletionEligibility.value={};return}await Promise.all(products.value.map(p=>refreshDeletionEligibility(p.id)))}
async function load(){loading.value=true;error.value='';try{const data=await api.products();products.value=data.items;canViewCost.value=data.canViewCost;await loadDeletionEligibility()}catch(e){error.value=e.message}finally{loading.value=false}}
function revokePreview(){if(imagePreview.value.startsWith('blob:'))URL.revokeObjectURL(imagePreview.value)}
function resetImage(image=''){revokePreview();selectedImage.value=null;imagePreview.value=image;if(imageInput.value)imageInput.value.value=''}
function openCreate(){editing.value={id:null};form.value=blank();resetImage()}
function openEdit(p){editing.value=p;form.value={...blank(),...p};resetImage(p.image||'')}
function close(){if(!saving.value){editing.value=null;resetImage()}}
function chooseProductImage(event){const [file]=event.target.files||[];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){error.value='请选择 JPG、PNG 或 WebP 图片';emit('toast',error.value);event.target.value='';return}if(file.size>5*1024*1024){error.value='商品图片不能超过 5 MB';emit('toast',error.value);event.target.value='';return}revokePreview();selectedImage.value=file;imagePreview.value=URL.createObjectURL(file);error.value=''}
function removeProductImage(){resetImage();form.value.image=''}
async function persistProduct(){saving.value=true;error.value='';try{if([...String(form.value.itemNumber||'').trim()].length>80)throw new Error('货号最多 80 个字符');if(selectedImage.value){const uploaded=await api.uploadProductImage(selectedImage.value);form.value.image=uploaded.url}const result=editing.value.id?await api.updateProduct(editing.value.id,payload(form.value)):await api.createProduct(payload(form.value));const item=result.item;const i=products.value.findIndex(p=>p.id===item.id);i<0?products.value.unshift(item):products.value.splice(i,1,item);await refreshDeletionEligibility(item.id);emit('toast',editing.value.id?'商品已更新':'商品已创建');editing.value=null;resetImage()}catch(e){error.value=e.message;emit('toast',error.value)}finally{saving.value=false}}
async function save(){if(editing.value?.id&&isProductActiveStatus(editing.value.status)&&!isProductActiveStatus(form.value.status)){pendingConfirm.value={kind:'save-inactive',product:editing.value};return}await persistProduct()}
async function updateStatus(p){const wasActive=isProductActiveStatus(p.status);try{await api.updateProduct(p.id,payload({...p,status:toggledProductStatus(p.status)}));emit('toast',wasActive?'商品已停用':'商品已启用');await load()}catch(e){error.value=e.message}}
async function toggleStatus(p){if(isProductActiveStatus(p.status)){pendingConfirm.value={kind:'inactive',product:p};return}await updateStatus(p)}
function requestDelete(p){if(!deletionEligibility.value[p.id]?.canDelete||deletingId.value)return;pendingConfirm.value={kind:'delete',product:p}}
async function deleteProduct(p){deletingId.value=p.id;error.value='';try{await api.deleteProduct(p.id);products.value=products.value.filter(item=>item.id!==p.id);const next={...deletionEligibility.value};delete next[p.id];deletionEligibility.value=next;if(editing.value?.id===p.id){editing.value=null;resetImage()}emit('toast','商品档案已永久删除')}catch(e){error.value=(e.reasons&&e.reasons[0])||e.message;emit('toast',error.value);await refreshDeletionEligibility(p.id)}finally{deletingId.value=null}}
function closeConfirm(){if(!saving.value&&!deletingId.value)pendingConfirm.value=null}
async function confirmPendingAction(){const action=pendingConfirm.value;if(!action)return;pendingConfirm.value=null;if(action.kind==='delete'){await deleteProduct(action.product);return}if(action.kind==='save-inactive'){await persistProduct();return}await updateStatus(action.product)}
function exportCSV(){downloadCSV('商品列表.csv',[['商品名称','货号','业务类型','分类','库存','成本价','售价','状态'],...filteredProducts.value.map(p=>[p.name,p.itemNumber||'',p.businessType,p.category,p.stock,canViewCost.value?p.costPrice:'无权限',p.price,p.status])]);emit('toast','商品列表已导出')}
onMounted(load)
</script>

<template>
  <section class="products-page">
    <div class="page-heading"><div><h2>商品中心</h2><p>集中维护商品资料、价格和销售状态；规格库存由小程序经营流程维护</p></div><div class="heading-actions"><button v-if="canExport" class="secondary" @click="exportCSV"><span class="material-symbols-outlined">download</span>导出</button><button v-if="canEdit" class="primary" @click="openCreate"><span class="material-symbols-outlined">add</span>新建商品</button></div></div>
    <div class="metrics product-metrics"><article><div><span>在售</span><strong>{{metrics.active}}</strong></div><i class="blue"><span class="material-symbols-outlined">storefront</span></i></article><article><div><span>服装</span><strong>{{metrics.clothing}}</strong></div><i class="cyan"><span class="material-symbols-outlined">styler</span></i></article><article><div><span>化妆品</span><strong>{{metrics.cosmetics}}</strong></div><i class="pink"><span class="material-symbols-outlined">face_retouching_natural</span></i></article><article class="alert"><div><span>资料待完善</span><strong>{{metrics.incomplete}}</strong></div><i><span class="material-symbols-outlined">warning</span></i></article></div>
    <article class="products-card"><div class="filterbar"><div class="filters"><label><span class="material-symbols-outlined">search</span><input v-model="query" placeholder="搜索名称/货号" /></label><select v-model="statusFilter"><option value="all">全部状态</option><option value="active">销售中</option><option value="inactive">已停用</option></select><select v-model="businessType"><option value="">全部业务</option><option>服装</option><option>化妆品</option></select><select v-model="stockStatus"><option value="">全部库存</option><option>有货</option><option>缺货</option></select></div><span class="muted">共 {{filteredProducts.length}} 条</span></div>
      <div v-if="error" class="inline-error"><span class="material-symbols-outlined">error</span>{{error}}<button @click="load">重新加载</button></div>
      <div class="products-table-wrap"><table class="products-table"><thead><tr><th>商品</th><th>货号</th><th class="secondary-column">业务类型</th><th class="secondary-column">分类</th><th class="right secondary-column">规格</th><th class="right">库存</th><th class="right">成本价</th><th class="right">参考售价</th><th>状态</th><th v-if="canEdit" class="center action-column">操作</th></tr></thead><tbody><tr v-for="p in filteredProducts" :key="p.id"><td><div class="product-cell"><img v-if="p.image" :src="p.image" alt=""><span v-else class="product-placeholder"><span class="material-symbols-outlined">inventory_2</span></span><b>{{p.name}}</b></div></td><td><div :class="{muted:!p.itemNumber}">{{p.itemNumber||'货号未填写'}}</div></td><td class="secondary-column">{{p.businessType}}</td><td class="secondary-column">{{p.category}}</td><td class="right mono secondary-column">{{p.specCount}}</td><td class="right mono" :class="{error:p.stock===0}">{{p.stock}}</td><td class="right mono">{{canViewCost?money(p.costPrice):'无权限'}}</td><td class="right mono">{{money(p.price)}}</td><td><span class="product-status" :class="{empty:!isProductActiveStatus(p.status)}"><i></i>{{p.status}}</span></td><td v-if="canEdit" class="center action-column"><div class="row-actions always"><button @click="openEdit(p)">编辑</button><button @click="toggleStatus(p)">{{isProductActiveStatus(p.status)?'停用':'重新启用'}}</button></div></td></tr><tr v-if="!filteredProducts.length&&!loading"><td :colspan="canEdit?10:9" class="empty-result">没有符合条件的商品</td></tr></tbody></table></div>
    </article><div v-if="loading" class="loading-line"></div>
    <div v-if="editing" class="dialog-backdrop" @mousedown.self="close"><form class="business-dialog wide" @submit.prevent="save"><div class="dialog-title"><div><h3>{{editing.id?'编辑商品':'新建商品'}}</h3><p>商品资料不会直接覆盖库存余额</p></div><button type="button" class="icon-button" @click="close"><span class="material-symbols-outlined">close</span></button></div><div class="form-grid"><label><span>商品名称 *</span><input v-model.trim="form.name" required /></label><label><span>货号（选填）</span><input v-model.trim="form.itemNumber" maxlength="80" placeholder="可填写吊牌、进货单或供应商货号" /></label><label><span>业务类型 *</span><select v-model="form.businessType"><option>服装</option><option>化妆品</option></select></label><label><span>分类 *</span><input v-model.trim="form.category" required /></label><label v-if="canViewCost"><span>成本价</span><input v-model.number="form.costPrice" type="number" min="0" step="0.01" /></label><label><span>参考售价</span><input v-model.number="form.price" type="number" min="0" step="0.01" /></label><label><span>规格数</span><input v-model.number="form.specCount" type="number" min="0" /></label><label><span>低库存阈值</span><input v-model.number="form.lowStockThreshold" type="number" min="0" /></label><label><span>货位</span><input v-model.trim="form.location" placeholder="例如 A-01" /></label><label><span>状态</span><select v-model="form.status"><option>销售中</option><option v-if="editing.id && form.status === '缺货'" disabled>缺货</option><option>已停用</option></select></label><section class="product-image-field span-2"><span>商品图片</span><div class="product-image-picker"><span class="product-image-preview"><img v-if="imagePreview" :src="imagePreview" alt="商品图片预览"><span v-else class="material-symbols-outlined">add_photo_alternate</span></span><div><p>从手机相册或电脑中选择，支持 JPG、PNG、WebP，最大 5 MB。</p><span class="product-image-actions"><button type="button" class="secondary compact" :disabled="saving" @click="imageInput.click()">{{imagePreview?'重新选择':'选择图片'}}</button><button v-if="imagePreview" type="button" class="text-button" :disabled="saving" @click="removeProductImage">移除图片</button></span></div><input ref="imageInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" @change="chooseProductImage"></div></section></div><section v-if="editing.id&&canDeleteProducts" class="danger-zone"><template v-if="editingDeletionEligibility?.canDelete"><div><h4>危险操作</h4><p>仅零库存且无经营历史的商品可以永久删除。</p></div><button type="button" class="danger-button" :disabled="deletingId===editing.id" @click="requestDelete(editing)">{{deletingId===editing.id?'删除中…':'永久删除商品'}}</button></template><p v-else-if="editingDeletionEligibility" class="deletion-hint">该商品已有经营记录，为保留历史数据不可永久删除；如不再经营，可停用商品。</p></section><div class="dialog-actions"><button type="button" class="secondary" @click="close">取消</button><button class="primary" :disabled="saving">{{saving?'保存中…':'保存商品'}}</button></div></form></div>
    <div v-if="pendingConfirm" class="dialog-backdrop action-confirm-backdrop" @mousedown.self="closeConfirm"><section class="business-dialog action-confirm" role="dialog" aria-modal="true" :aria-labelledby="`product-confirm-${pendingConfirm.kind}`"><div class="confirm-icon"><span class="material-symbols-outlined">{{pendingConfirm.kind==='delete'?'delete_forever':'block'}}</span></div><h3 :id="`product-confirm-${pendingConfirm.kind}`">{{pendingConfirm.kind==='delete'?'永久删除商品':'确认停用商品'}}</h3><p>{{pendingConfirm.kind==='delete'?'该商品尚无经营记录，将永久删除商品档案，此操作不可撤销。':'停用后，该商品将不再参与卖货、拿货和普通 AI 匹配，历史记录仍会保留。确定停用吗？'}}</p><div class="dialog-actions"><button type="button" class="secondary" @click="closeConfirm">取消</button><button type="button" class="danger-button" :disabled="saving||deletingId" @click="confirmPendingAction">{{pendingConfirm.kind==='delete'?'永久删除':'确认停用'}}</button></div></section></div>
  </section>
</template>

<style scoped>
.action-column{position:sticky;right:0;z-index:3;min-width:144px;background:#fff;box-shadow:-10px 0 18px -18px rgba(20,43,58,.65)}
thead .action-column{z-index:5;background:#f4f7f9}
tbody tr:hover .action-column{background:#f9fbfd}
.row-actions{gap:4px}
.danger-zone{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px;padding:16px;border:1px solid #efc9cf;border-radius:10px;background:#fff8f9}
.danger-zone h4{margin:0;color:#8f2630;font-size:14px}
.danger-zone p{margin:5px 0 0;color:#687781;font-size:12px;line-height:1.6}
.danger-zone .danger-button{flex:none}
.danger-zone .deletion-hint{margin:0;color:#667781}
.action-confirm-backdrop{z-index:210}
.action-confirm{width:min(440px,100%);text-align:center}
.confirm-icon{display:grid;width:54px;height:54px;margin:0 auto 15px;place-items:center;border-radius:50%;color:var(--danger);background:#fbe8eb}
.action-confirm h3{margin:0;color:#102b3c;font-size:20px}
.action-confirm p{margin:10px 0 0;color:#506877;font-size:13px;line-height:1.75}
.action-confirm .dialog-actions{margin-right:-22px;margin-bottom:-22px;margin-left:-22px;padding-right:22px;padding-left:22px}
@media(max-width:1280px){
  .products-table{min-width:880px}
  .products-table th,.products-table td{padding-right:10px;padding-left:10px}
  .products-table th:first-child{width:190px}
  .secondary-column{max-width:92px;overflow:hidden;text-overflow:ellipsis}
}
@media(max-width:1100px){
  .products-table{min-width:740px}
  .secondary-column{display:none}
  .action-column{min-width:136px}
}
</style>
