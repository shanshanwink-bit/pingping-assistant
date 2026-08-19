package service

import (
	"context"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

func TestAnalysisReadsMiniSalesIncomeAndExpense(t *testing.T) {
	repo := &dashboardRepo{data: domain.OperatingData{
		Sales: []domain.Sale{
			{ProductName: "连衣裙", BusinessType: "服装", Amount: 120, CostAmount: 50, Profit: 70, HasCost: true, Quantity: 1, PaymentMethod: "微信支付", Status: "effective", CreatedAt: "2026-08-18 10:00"},
			{ProductName: "口红", BusinessType: "化妆品", Amount: 80, Quantity: 1, PaymentMethod: "现金", Status: "effective", CreatedAt: "2026-08-19 10:00"},
		},
		Entries: []domain.FinanceEntry{
			{EntryType: "income", Amount: 15, BusinessType: "服装", Status: "effective", OccurredOn: "2026-08-18"},
			{EntryType: "expense", Amount: 5, BusinessType: "服装", Status: "effective", OccurredOn: "2026-08-18"},
		},
		Purchases: []domain.Purchase{{BusinessType: "服装", TotalCost: 300, Status: "effective", CreatedAt: "2026-08-18 09:00"}},
	}}
	admin := NewAdminService(repo, time.Hour)
	result, err := admin.Analysis(context.Background(), domain.Account{Permissions: []string{"finance.profit.view", "finance.cost.view"}}, "2026-08-18", "2026-08-19", "全部")
	if err != nil {
		t.Fatal(err)
	}
	if result.Revenue != 200 || result.Cost != 50 || result.GrossProfit != 70 || result.OperatingProfit != 80 {
		t.Fatalf("unexpected operating definition: %#v", result)
	}
	if result.PurchaseExpense != 300 || result.MissingCostSales != 1 || len(result.Trend) != 2 {
		t.Fatalf("cash/missing/trend mismatch: %#v", result)
	}
}

func TestSevenDayTrendUsesOperatingProfit(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, businessLocation)
	data := domain.OperatingData{
		Sales:   []domain.Sale{{Amount: 100, CostAmount: 40, Profit: 60, HasCost: true, Status: "effective", CreatedAt: "2026-08-13 10:00"}},
		Entries: []domain.FinanceEntry{{EntryType: "expense", Amount: 10, Status: "effective", OccurredOn: "2026-08-13"}},
	}
	trend := sevenDayProfit(data, now)
	if len(trend) != 7 || trend[0] != 50 {
		t.Fatalf("unexpected seven-day operating profit: %#v", trend)
	}
}

func TestFinalOperatingDefinitionSeparatesPurchasesFromProfit(t *testing.T) {
	repo := &dashboardRepo{data: domain.OperatingData{
		Sales: []domain.Sale{{Amount: 100, CostAmount: 50, Profit: 50, HasCost: true, Quantity: 1, Status: "effective", CreatedAt: "2026-08-19 10:00"}},
		Entries: []domain.FinanceEntry{
			{EntryType: "income", Amount: 100, Status: "effective", OccurredOn: "2026-08-19"},
			{EntryType: "expense", Amount: 30, Status: "effective", OccurredOn: "2026-08-19"},
		},
		Purchases: []domain.Purchase{{Quantity: 5, TotalCost: 250, Status: "effective", CreatedAt: "2026-08-19 09:00"}},
	}}
	admin := NewAdminService(repo, time.Hour)
	result, err := admin.Analysis(context.Background(), domain.Account{Permissions: []string{"finance.profit.view", "finance.cost.view"}}, "2026-08-19", "2026-08-19", "全部")
	if err != nil {
		t.Fatal(err)
	}
	if result.Revenue != 100 || result.Cost != 50 || result.GrossProfit != 50 || result.OperatingProfit != 120 || result.PurchaseExpense != 250 {
		t.Fatalf("unexpected final operating definition: %#v", result)
	}
}

func TestMissingCostSaleNeverTurnsRevenueIntoProfit(t *testing.T) {
	repo := &dashboardRepo{data: domain.OperatingData{Sales: []domain.Sale{{Amount: 100, Profit: 100, HasCost: false, Quantity: 1, Status: "effective", CreatedAt: "2026-08-19 10:00"}}}}
	admin := NewAdminService(repo, time.Hour)
	result, err := admin.Analysis(context.Background(), domain.Account{Permissions: []string{"finance.profit.view", "finance.cost.view"}}, "2026-08-19", "2026-08-19", "全部")
	if err != nil {
		t.Fatal(err)
	}
	if result.Revenue != 100 || result.GrossProfit != 0 || result.OperatingProfit != 0 || result.MissingCostSales != 1 {
		t.Fatalf("missing-cost sale was treated as profit: %#v", result)
	}
}
