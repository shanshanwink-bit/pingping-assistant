package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type businessRepo struct {
	Repository
	created             domain.ProductInput
	updated             domain.ProductInput
	adjusted            domain.StockAdjustmentInput
	deleted             domain.ProductDeletionInput
	deletionEligibility domain.ProductDeletionEligibility
	deleteErr           error
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
	input := r.created
	if r.updated.Name != "" {
		input = r.updated
	}
	return domain.Product{
		ID: id, Name: input.Name, Code: input.Code, ItemNumber: input.ItemNumber,
		ItemNumberManaged: input.ItemNumberManaged, Category: input.Category, CostPrice: input.CostPrice,
		Price: input.Price, Status: input.Status,
	}, nil
}

func (r *businessRepo) AdjustStock(_ context.Context, _ domain.Account, input domain.StockAdjustmentInput) error {
	r.adjusted = input
	return nil
}

func (r *businessRepo) ProductDeletionEligibility(_ context.Context, _ string, _ int64) (domain.ProductDeletionEligibility, error) {
	return r.deletionEligibility, r.deleteErr
}

func (r *businessRepo) DeleteProduct(_ context.Context, _ domain.Account, input domain.ProductDeletionInput) error {
	r.deleted = input
	return r.deleteErr
}

func TestCreateProductNormalizesAndChecksPermission(t *testing.T) {
	repo := &businessRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit"}}
	item, err := admin.CreateProduct(context.Background(), actor, ProductInput{
		Name: " 针织衫 ", Code: " client-code ", ItemNumber: " A-136 ", BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.ID != 9 || repo.created.Name != "针织衫" || repo.created.ItemNumber != "A-136" || !repo.created.ItemNumberManaged || repo.created.Code != "0001" {
		t.Fatalf("unexpected normalized product: %#v / %#v", item, repo.created)
	}
	_, err = admin.CreateProduct(context.Background(), domain.Account{Role: "clerk"}, ProductInput{})
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestUpdateProductPreservesSystemCode(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{Name: "原商品", Code: "0012", ItemNumber: "OLD-12", CostPrice: 30}}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit", "finance.cost.view"}}
	_, err := admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "新商品", Code: "tampered", ItemNumber: " NEW-12 ", BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.Code != "0012" {
		t.Fatalf("updated code = %q, want preserved system code", repo.updated.Code)
	}
	if repo.updated.ItemNumber != "NEW-12" {
		t.Fatalf("updated itemNumber = %q, want normalized business item number", repo.updated.ItemNumber)
	}
}

func TestProductItemNumberAllowsEmptyAndLimitsLength(t *testing.T) {
	repo := &businessRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit"}}

	_, err := admin.CreateProduct(context.Background(), actor, ProductInput{
		Name: "针织衫", ItemNumber: "   ", BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.created.ItemNumber != "" {
		t.Fatalf("empty itemNumber = %q, want empty value for SQL NULL", repo.created.ItemNumber)
	}

	_, err = admin.CreateProduct(context.Background(), actor, ProductInput{
		Name: "针织衫", ItemNumber: strings.Repeat("货", 81), BusinessType: "服装", Category: "上衣", Price: 99,
	})
	if err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for 81-character itemNumber, got %v", err)
	}
}

func TestUpdateProductExplicitClearMarksItemNumberManaged(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{
		Name: "原商品", Code: "0012", ItemNumber: "OLD-12", BusinessType: "服装", Category: "上衣", Status: "销售中",
	}}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit", "finance.cost.view"}}

	_, err := admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "原商品", Code: "tampered", ItemNumber: "", BusinessType: "服装", Category: "上衣", Status: "销售中",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.ItemNumber != "" || !repo.updated.ItemNumberManaged {
		t.Fatalf("explicit clear was not preserved: %#v", repo.updated)
	}
	if repo.updated.Code != "0012" {
		t.Fatalf("explicit clear changed code to %q", repo.updated.Code)
	}
	if !strings.Contains(repo.updated.AuditSummary, "itemNumber: OLD-12 → 未填写") {
		t.Fatalf("audit summary does not describe clear: %q", repo.updated.AuditSummary)
	}
}

func TestLegacyNullItemNumberRemainsUnmanagedWithoutItemNumberChange(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{
		Name: "原商品", Code: "0012", BusinessType: "服装", Category: "上衣", Status: "销售中",
	}}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Role: "admin", Permissions: []string{"products.edit", "finance.cost.view"}}

	_, err := admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "改名商品", ItemNumber: "", BusinessType: "服装", Category: "上衣", Status: "销售中",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.ItemNumberManaged {
		t.Fatal("legacy NULL itemNumber should remain unmanaged when itemNumber did not change")
	}
}

func TestProductEditAuditListsChangedGovernedFields(t *testing.T) {
	summary := productEditSummary(domain.Product{
		Name: "旧名", ItemNumber: "OLD", Category: "上衣", Price: 80, CostPrice: 30, Status: "销售中",
	}, ProductInput{
		Name: "新名", ItemNumber: "NEW", Category: "外套", Price: 99, CostPrice: 40, Status: "已停用",
	})
	for _, field := range []string{"name:", "itemNumber:", "category:", "salePrice:", "costPrice:", "status:"} {
		if !strings.Contains(summary, field) {
			t.Fatalf("audit summary missing %s: %q", field, summary)
		}
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

func TestInactiveProductRejectsStockAdjustmentAndSale(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{Status: domain.ProductStatusInactive}}
	admin := NewAdminService(repo, time.Hour)
	stockActor := domain.Account{StoreID: "store-1", Permissions: []string{"inventory.adjust"}}
	if err := admin.AdjustStock(context.Background(), stockActor, StockAdjustmentInput{
		ProductID: 9, QuantityChange: 1, Reason: "测试",
	}); err != domain.ErrProductInactive {
		t.Fatalf("inactive stock adjustment error = %v", err)
	}
	if repo.adjusted.ProductID != 0 {
		t.Fatal("inactive stock adjustment reached repository write")
	}
	saleActor := domain.Account{StoreID: "store-1", Permissions: []string{"sales.edit"}}
	if _, err := admin.CreateSale(context.Background(), saleActor, SaleInput{
		ProductID: 9, Quantity: 1, UnitPrice: 10, PaymentMethod: "现金",
	}); err != domain.ErrProductInactive {
		t.Fatalf("inactive sale error = %v", err)
	}
}

func TestStatusChangeUsesDedicatedAuditAction(t *testing.T) {
	repo := &businessRepo{created: domain.ProductInput{
		Name: "原商品", Code: "0012", BusinessType: "服装", Category: "上衣", Status: domain.ProductStatusSelling,
	}}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{StoreID: "store-1", Permissions: []string{"products.edit", "finance.cost.view"}}
	_, err := admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "原商品", BusinessType: "服装", Category: "上衣", Status: domain.ProductStatusInactive,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.AuditAction != "停用商品" || repo.updated.AuditRisk != "warning" {
		t.Fatalf("unexpected disable audit: %#v", repo.updated)
	}
	_, err = admin.UpdateProduct(context.Background(), actor, 9, ProductInput{
		Name: "原商品", BusinessType: "服装", Category: "上衣", Status: domain.ProductStatusSelling,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.updated.AuditAction != "重新启用商品" || repo.updated.AuditRisk != "warning" {
		t.Fatalf("unexpected enable audit: %#v", repo.updated)
	}
}

func TestProductDeletionIsOwnerOnlyAndForwardsEligibility(t *testing.T) {
	repo := &businessRepo{deletionEligibility: domain.ProductDeletionEligibility{CanDelete: true, Reasons: []string{}}}
	admin := NewAdminService(repo, time.Hour)
	owner := domain.Account{StoreID: "store-1", Role: "owner"}

	eligibility, err := admin.ProductDeletionEligibility(context.Background(), owner, 7)
	if err != nil || !eligibility.CanDelete {
		t.Fatalf("unexpected eligibility result: %#v / %v", eligibility, err)
	}
	if _, err = admin.ProductDeletionEligibility(context.Background(), domain.Account{Role: "admin", Permissions: []string{"products.edit"}}, 7); err != ErrProductDeleteForbidden {
		t.Fatalf("admin eligibility error = %v, want owner-only error", err)
	}

	input := domain.ProductDeletionInput{ProductID: 7, RequestID: "request-delete-1"}
	if err = admin.DeleteProduct(context.Background(), owner, input); err != nil {
		t.Fatal(err)
	}
	if repo.deleted != input {
		t.Fatalf("deleted product = %#v, want %#v", repo.deleted, input)
	}
	if err = admin.DeleteProduct(context.Background(), domain.Account{Role: "admin", Permissions: []string{"products.edit"}}, input); err != ErrProductDeleteForbidden {
		t.Fatalf("admin delete error = %v, want owner-only error", err)
	}
}

func TestProductDeletionHistoryErrorIsNotBypassedByInactiveStatus(t *testing.T) {
	blocked := &domain.ProductDeletionBlockedError{Reasons: []string{"该商品已有采购记录，不能永久删除，请停用商品。"}}
	repo := &businessRepo{deleteErr: blocked}
	admin := NewAdminService(repo, time.Hour)
	owner := domain.Account{StoreID: "store-1", Role: "owner"}

	if err := admin.DeleteProduct(context.Background(), owner, domain.ProductDeletionInput{ProductID: 7}); err != blocked {
		t.Fatalf("delete error = %v, want unchanged history error", err)
	}
}
