package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"pingping-assistant-admin/internal/domain"
)

func (r *AdminRepository) AuditLogs(ctx context.Context, storeID string) ([]domain.AuditLog, error) {
	adminItems, err := r.adminAuditLogs(ctx, storeID)
	if err != nil {
		return nil, err
	}
	miniItems, err := r.miniAuditLogs(ctx, storeID)
	if err != nil {
		return nil, err
	}
	items := mergeAuditLogs(adminItems, miniItems)
	return items, nil
}

func mergeAuditLogs(groups ...[]domain.AuditLog) []domain.AuditLog {
	items := make([]domain.AuditLog, 0)
	for _, group := range groups {
		items = append(items, group...)
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	if len(items) > 500 {
		items = items[:500]
	}
	return items
}

func (r *AdminRepository) adminAuditLogs(ctx context.Context, storeID string) ([]domain.AuditLog, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id,operator_name,operator_role,action,object_type,object_id,summary,reason,source,risk_level,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') FROM admin_audit_logs WHERE store_id=? ORDER BY id DESC LIMIT 500`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AuditLog, 0)
	for rows.Next() {
		var item domain.AuditLog
		if err := rows.Scan(&item.ID, &item.OperatorName, &item.OperatorRole, &item.Action, &item.ObjectType, &item.ObjectID, &item.Summary, &item.Reason, &item.Source, &item.RiskLevel, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Source = "管理后台"
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AdminRepository) miniAuditLogs(ctx context.Context, storeID string) ([]domain.AuditLog, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT logs.id,COALESCE(users.display_name,''),COALESCE(members.role,''),logs.action,
		       logs.target_type,COALESCE(logs.target_id,''),COALESCE(logs.details,JSON_OBJECT()),
		       DATE_FORMAT(logs.created_at,'%Y-%m-%d %H:%i:%s')
		FROM audit_logs logs
		LEFT JOIN users ON users.id=logs.user_id
		LEFT JOIN store_members members ON members.store_id=logs.store_id AND members.user_id=logs.user_id
		WHERE logs.store_id=? ORDER BY logs.id DESC LIMIT 500`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AuditLog, 0)
	for rows.Next() {
		var id int64
		var operatorName, role, action, targetType, targetID, createdAt string
		var details []byte
		if err := rows.Scan(&id, &operatorName, &role, &action, &targetType, &targetID, &details, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, adaptMiniAudit(id, operatorName, role, action, targetType, targetID, details, createdAt))
	}
	return items, rows.Err()
}

func adaptMiniAudit(id int64, operatorName, role, action, targetType, targetID string, details []byte, createdAt string) domain.AuditLog {
	label, objectType, risk := action, targetType, "normal"
	switch action {
	case "miniapp.sale.create":
		label, objectType = "小程序卖货", "销售"
	case "miniapp.purchase.create":
		label, objectType = "小程序拿货", "采购"
	}
	return domain.AuditLog{
		ID: id, OperatorName: operatorName, OperatorRole: roleName(role), Action: label,
		ObjectType: objectType, ObjectID: targetID, Summary: miniAuditSummary(details),
		Source: "微信小程序", RiskLevel: risk, CreatedAt: createdAt,
	}
}

func miniAuditSummary(raw []byte) string {
	var details struct {
		ProductID   string `json:"productId"`
		SpecID      string `json:"specId"`
		Quantity    int    `json:"quantity"`
		BeforeStock int    `json:"beforeStock"`
		AfterStock  int    `json:"afterStock"`
	}
	if json.Unmarshal(raw, &details) != nil {
		return ""
	}
	parts := make([]string, 0, 3)
	if details.ProductID != "" {
		parts = append(parts, "商品 "+details.ProductID)
	}
	if details.SpecID != "" {
		parts = append(parts, "规格 "+details.SpecID)
	}
	parts = append(parts, fmt.Sprintf("数量 %d，库存 %d → %d", details.Quantity, details.BeforeStock, details.AfterStock))
	return strings.Join(parts, " · ")
}

func roleName(role string) string {
	switch role {
	case "owner":
		return "店主"
	case "admin":
		return "管理员"
	case "finance":
		return "财务"
	case "clerk":
		return "店员"
	default:
		return ""
	}
}
