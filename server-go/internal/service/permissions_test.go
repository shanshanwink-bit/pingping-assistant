package service

import (
	"context"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type permissionRepo struct {
	Repository
	saleCreated, saleReversed, entryCreated, entryReversed bool
}

func (r *permissionRepo) Product(context.Context, string, int64) (domain.Product, error) {
	return domain.Product{Status: domain.ProductStatusSelling}, nil
}

func (r *permissionRepo) CreateSale(context.Context, domain.Account, domain.SaleInput) (int64, error) {
	r.saleCreated = true
	return 1, nil
}
func (r *permissionRepo) Sales(context.Context, string) ([]domain.Sale, error) {
	return []domain.Sale{{ID: 1}}, nil
}
func (r *permissionRepo) ReverseSale(context.Context, domain.Account, int64, string) error {
	r.saleReversed = true
	return nil
}
func (r *permissionRepo) CreateFinanceEntry(context.Context, domain.Account, domain.FinanceEntryInput) (int64, error) {
	r.entryCreated = true
	return 1, nil
}
func (r *permissionRepo) ReverseFinanceEntry(context.Context, domain.Account, int64, string) error {
	r.entryReversed = true
	return nil
}

func TestSalesWritesRequireSalesPermission(t *testing.T) {
	repo := &permissionRepo{}
	admin := NewAdminService(repo, time.Hour)
	input := domain.SaleInput{ProductID: 1, Quantity: 1, PaymentMethod: "现金"}
	if _, err := admin.CreateSale(context.Background(), domain.Account{Permissions: []string{"finance.entry.edit"}}, input); err != ErrForbidden {
		t.Fatalf("finance permission must not create sale: %v", err)
	}
	actor := domain.Account{Permissions: []string{"sales.edit"}}
	if _, err := admin.CreateSale(context.Background(), actor, input); err != nil {
		t.Fatal(err)
	}
	if err := admin.ReverseSale(context.Background(), actor, 1, "测试"); err != nil {
		t.Fatal(err)
	}
	if !repo.saleCreated || !repo.saleReversed {
		t.Fatal("sales repository methods were not called")
	}
}

func TestFinanceWritesRequireFinancePermission(t *testing.T) {
	repo := &permissionRepo{}
	admin := NewAdminService(repo, time.Hour)
	input := domain.FinanceEntryInput{EntryType: "income", Category: "补贴", Amount: 10, OccurredOn: "2026-08-19"}
	if err := admin.CreateFinanceEntry(context.Background(), domain.Account{Permissions: []string{"sales.edit"}}, input); err != ErrForbidden {
		t.Fatalf("sales permission must not create finance entry: %v", err)
	}
	actor := domain.Account{Permissions: []string{"finance.entry.edit"}}
	if err := admin.CreateFinanceEntry(context.Background(), actor, input); err != nil {
		t.Fatal(err)
	}
	if err := admin.ReverseFinanceEntry(context.Background(), actor, 1, "测试"); err != nil {
		t.Fatal(err)
	}
	if !repo.entryCreated || !repo.entryReversed {
		t.Fatal("finance repository methods were not called")
	}
}
