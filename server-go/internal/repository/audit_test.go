package repository

import (
	"testing"

	"pingping-assistant-admin/internal/domain"
)

func TestAuditSourcesAndTimeOrdering(t *testing.T) {
	mini := adaptMiniAudit(2, "小王", "clerk", "miniapp.sale.create", "sale", "sale-1",
		[]byte(`{"productId":"p1","specId":"s1","quantity":2,"beforeStock":5,"afterStock":3}`), "2026-08-19 11:00:00")
	admin := domain.AuditLog{ID: 1, Source: "管理后台", CreatedAt: "2026-08-19 10:00:00"}
	items := mergeAuditLogs([]domain.AuditLog{admin}, []domain.AuditLog{mini})
	if len(items) != 2 || items[0].Source != "微信小程序" || items[1].Source != "管理后台" {
		t.Fatalf("audit source/order mismatch: %#v", items)
	}
	if mini.OperatorRole != "店员" || mini.Action != "小程序卖货" || mini.Summary == "" {
		t.Fatalf("mini audit adaptation mismatch: %#v", mini)
	}
}

func TestMiniAuditSummaryHidesExperienceIdentifiers(t *testing.T) {
	summary := miniAuditSummary([]byte(`{"productId":"demo-coat","specId":"demo-coat-ivory-s","quantity":1,"beforeStock":2,"afterStock":1}`))
	if summary != "数量 1，库存 2 → 1" {
		t.Fatalf("experience identifiers should not be user-visible: %q", summary)
	}
}
