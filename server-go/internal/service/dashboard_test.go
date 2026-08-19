package service

import (
	"context"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type dashboardRepo struct {
	Repository
	storeID  string
	data     domain.OperatingData
	products []domain.Product
}

func (r *dashboardRepo) OperatingData(_ context.Context, storeID string) (domain.OperatingData, error) {
	r.storeID = storeID
	return r.data, nil
}
func (r *dashboardRepo) Products(_ context.Context, _ string) ([]domain.Product, error) {
	return r.products, nil
}

func TestDashboardUsesUnifiedOperatingDefinition(t *testing.T) {
	repo := &dashboardRepo{
		data: domain.OperatingData{
			Sales: []domain.Sale{
				{Amount: 100, CostAmount: 40, Profit: 60, Quantity: 1, HasCost: true, Status: "effective", BusinessType: "服装", CreatedAt: "2026-08-19 00:30"},
				{Amount: 50, Quantity: 1, Status: "effective", BusinessType: "服装", CreatedAt: "2026-08-19 12:00"},
			},
			Entries: []domain.FinanceEntry{
				{EntryType: "income", Amount: 20, Status: "effective", BusinessType: "服装", OccurredOn: "2026-08-19"},
				{EntryType: "expense", Amount: 10, Status: "effective", BusinessType: "服装", OccurredOn: "2026-08-19"},
			},
			Purchases: []domain.Purchase{{TotalCost: 70, Status: "effective", BusinessType: "服装", CreatedAt: "2026-08-19 08:00"}},
		},
		products: []domain.Product{{Stock: 3, CostPrice: 20}},
	}
	admin := NewAdminService(repo, time.Hour)
	admin.now = func() time.Time { return time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC) }
	actor := domain.Account{StoreID: "store-1", Permissions: []string{"dashboard.view", "finance.cost.view", "finance.profit.view"}}

	result, err := admin.Dashboard(context.Background(), actor)
	if err != nil {
		t.Fatal(err)
	}
	if repo.storeID != "store-1" || result.SalesAmount != 150 || result.SoldCost != 40 {
		t.Fatalf("unexpected dashboard source/amounts: %q / %#v", repo.storeID, result)
	}
	if result.Profit != 70 || result.PurchaseExpense != 70 {
		t.Fatalf("profit must not deduct purchase again: %#v", result)
	}
	if result.MissingCostSales != 1 || result.Trend[6] != 70 {
		t.Fatalf("missing-cost/trend mismatch: %#v", result)
	}
}

func TestDashboardUsesChinaBusinessDateBoundary(t *testing.T) {
	repo := &dashboardRepo{data: domain.OperatingData{Sales: []domain.Sale{{
		Amount: 88, CostAmount: 30, Profit: 58, HasCost: true, Quantity: 1,
		Status: "effective", BusinessType: "服装", CreatedAt: "2026-08-19 00:10",
	}}}}
	admin := NewAdminService(repo, time.Hour)
	admin.now = func() time.Time { return time.Date(2026, 8, 18, 16, 30, 0, 0, time.UTC) }
	result, err := admin.Dashboard(context.Background(), domain.Account{Permissions: []string{"dashboard.view", "finance.profit.view"}})
	if err != nil || result.SalesAmount != 88 {
		t.Fatalf("China date boundary not applied: %#v / %v", result, err)
	}
}

func TestDashboardRedactsCostAndProfitWithoutPermissions(t *testing.T) {
	repo := &dashboardRepo{
		data:     domain.OperatingData{Sales: []domain.Sale{{Amount: 100, CostAmount: 40, Profit: 60, HasCost: true, Quantity: 1, Status: "effective", CreatedAt: "2026-08-19 10:00"}}},
		products: []domain.Product{{Stock: 2, CostPrice: 30}},
	}
	admin := NewAdminService(repo, time.Hour)
	admin.now = func() time.Time { return time.Date(2026, 8, 19, 10, 0, 0, 0, businessLocation) }
	result, err := admin.Dashboard(context.Background(), domain.Account{Permissions: []string{"dashboard.view"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.CanViewCost || result.CanViewProfit || result.SoldCost != 0 || result.InventoryCost != 0 || result.Profit != 0 {
		t.Fatalf("sensitive fields not redacted: %#v", result)
	}
}

func TestDashboardRequiresPermission(t *testing.T) {
	admin := NewAdminService(&dashboardRepo{}, time.Hour)
	if _, err := admin.Dashboard(context.Background(), domain.Account{}); err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
