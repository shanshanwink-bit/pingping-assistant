export const NAV_ITEMS = [
  { id: 'dashboard', icon: 'dashboard', label: '经营看板', permission: 'dashboard.view' },
  { id: 'products', icon: 'inventory_2', label: '商品中心', permission: 'products.view' },
  { id: 'inventory', icon: 'warehouse', label: '库存中心', permission: 'inventory.view' },
  { id: 'sales', icon: 'payments', label: '销售与收支', permission: 'sales.view' },
  { id: 'analysis', icon: 'analytics', label: '经营分析', permission: 'finance.profit.view' },
  { id: 'employees', icon: 'badge', label: '员工与权限', permission: 'system.staff.manage' },
  { id: 'audit', icon: 'history', label: '操作日志', permission: 'system.audit.view' }
]

export const canAccess = (user, permission) => Boolean(
  user && (user.role === 'owner' || user.permissions?.includes(permission))
)

export const visibleNavItems = user => NAV_ITEMS.filter(item => canAccess(user, item.permission))

export const firstAllowedPage = user => visibleNavItems(user)[0]?.id || ''

export const canOpenPage = (user, page) => visibleNavItems(user).some(item => item.id === page)
