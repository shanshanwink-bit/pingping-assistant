<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../../services/api'

defineProps({ activePage: String })
const labels={dashboard:'经营概览',products:'商品资料与状态',inventory:'实时库存与流水',sales:'经营记录查看',analysis:'经营数据分析',employees:'账号与访问控制',audit:'安全与业务审计'}
const serverTime=ref('正在同步…'),serverOnline=ref(true)
let clockOffset=0,tickTimer,syncTimer
const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
function display(value){return formatter.format(value).replaceAll('/','-')}
function tick(){serverTime.value=display(new Date(Date.now()+clockOffset))}
async function syncServerClock(){
  try{const data=await api.health();clockOffset=new Date(data.time).getTime()-Date.now();serverOnline.value=data.ok&&data.database==='connected';tick()}
  catch{serverOnline.value=false;clockOffset=0;tick()}
}
onMounted(()=>{tick();syncServerClock();tickTimer=setInterval(tick,1000);syncTimer=setInterval(syncServerClock,60000)})
onBeforeUnmount(()=>{clearInterval(tickTimer);clearInterval(syncTimer)})
</script>

<template>
  <header class="topbar">
    <div class="topbar-context"><span class="topbar-section-mark" aria-hidden="true">◆</span><span>{{labels[activePage]||'管理后台'}}</span></div>
    <div class="server-status"><span class="connection-state"><i :class="{offline:!serverOnline}"></i>{{serverOnline?'自有服务器已连接':'服务器连接异常'}}</span><span class="server-clock">北京时间 {{serverTime}}</span></div>
  </header>
</template>
