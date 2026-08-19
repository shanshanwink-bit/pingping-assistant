package service

import (
	"context"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type businessRepo struct {
	Repository
	created  domain.ProductInput
	updated  domain.ProductInput
	adjusted domain.StockAdjustmentInput
	deleted  int64
}

func (r *businessRepo) CreateProduct(_ context.Context, _ domain.Account, input domain.ProductInput) (int64, error) {
	r.created = input
	r.created.Code = "0001"
	return 9, nil
}

func (r *businessRepo) UpdateProduct(_ context.Context, _ domain.Account, _ int64, input domain.ProductInput) error {
	r.updated = input
	return nil
}

func (r *businessRepo) Product(_ context.Context, _ string, id int64) (domain.Product, error) {
	return domain.Product{ID: id, Name: r.created.Name, Code: r.created.Code}, nil
}

func (r *businessRepo) AdjustStock(_ context.Context, _ domain.Account, input domain.StockAdjustmentInput) error {
	r.adjusted = input
	return nil
}

func (r *businessRepo) DeleteProduct(_ context.Context, _ domain.Account, id int64) error {
	r.deleted = id
	return nil
}

func TestCreateProductNormalizesAndChecksPermission(t *testing.T) {
	repo := &businessRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit"}}
	item, err := admin.CreateProduct(context.Background(), actor, ProductInput{
		Name: " 针织衫 ", Code: " client-code ", BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.ID != 9 || repo.created.Name != "针织衫" || repo.created.Code != "0001" {
		t.Fatalf("unexpected normalized product: %#v / %#v", item, repo.created)
	}
	_, err = admin.CreateProduct(context.Background(), domain.Account{Role: "clerk"}, ProductInput{})
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestUpdateProductPreservesSystemCode(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{Name: "原商品", Code: "0012", CostPrice: 30}}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit", "finance.cost.view"}}
	_, err := admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "新商品", Code: "tampered", BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.Code != "0012" {
		t.Fatalf("updated code = %q, want preserved system code", repo.updated.Code)
	}
}

func TestAdjustStockRequiresReasonAndChange(t *testing.T) {
	repo := &businessRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{Role: "admin", Permissions: []string{"inventory.adjust"}}
	if err := admin.AdjustStock(context.Background(), actor, StockAdjustmentInput{ProductID: 2, QuantityChange: 3}); err != ErrInvalidInput {
		t.Fatalf("expected invalid input without reason, got %v", err)
	}
	if err := admin.AdjustStock(context.Background(), actor, StockAdjustmentInput{ProductID: 2, QuantityChange: -3, Reason: "盘亏"}); err != nil {
		t.Fatal(err)
	}
	if repo.adjusted.QuantityChange != -3 {
		t.Fatalf("adjustment not sent to repository: %#v", repo.adjusted)
	}
}

func TestDeleteProductDoesNotRequireReason(t *testing.T) {
	repo := &businessRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{Role: "admin", Permissions: []string{"products.edit"}}

	if err := admin.DeleteProduct(context.Background(), actor, 7); err != nil {
		t.Fatal(err)
	}
	if repo.deleted != 7 {
		t.Fatalf("deleted product = %d, want 7", repo.deleted)
	}
	if err := admin.DeleteProduct(context.Background(), domain.Account{Role: "clerk"}, 7); err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
