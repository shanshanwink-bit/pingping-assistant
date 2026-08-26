package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"pingping-assistant-admin/internal/domain"
)

type ProductInput = domain.ProductInput
type StockAdjustmentInput = domain.StockAdjustmentInput
type SaleInput = domain.SaleInput
type FinanceEntryInput = domain.FinanceEntryInput
type SettingInput = domain.SettingInput

func normalizeProduct(input *ProductInput) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.ItemNumber = strings.TrimSpace(input.ItemNumber)
	input.Category, input.Location, input.Image = strings.TrimSpace(input.Category), strings.TrimSpace(input.Location), strings.TrimSpace(input.Image)
	if input.Status == "" {
		input.Status = domain.ProductStatusSelling
	}
	return input.Name != "" && utf8.RuneCountInString(input.Name) <= 120 &&
		utf8.RuneCountInString(input.ItemNumber) <= 80 &&
		(input.BusinessType == "服装" || input.BusinessType == "化妆品") &&
		input.Category != "" && utf8.RuneCountInString(input.Category) <= 40 && input.SpecCount >= 0 &&
		validProductMoney(input.CostPrice) && validProductMoney(input.Price) && input.LowStockThreshold >= 0 &&
		domain.IsEditableProductStatus(input.Status)
}

func validProductMoney(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 9999999999.99
}

func auditText(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 32 {
		return string(runes[:32]) + "…"
	}
	if len(runes) == 0 {
		return "未填写"
	}
	return string(runes)
}

func productEditSummary(current domain.Product, input ProductInput) string {
	changes := make([]string, 0, 6)
	if current.Name != input.Name {
		changes = append(changes, fmt.Sprintf("name: %s → %s", auditText(current.Name), auditText(input.Name)))
	}
	if current.ItemNumber != input.ItemNumber {
		changes = append(changes, fmt.Sprintf("itemNumber: %s → %s", auditText(current.ItemNumber), auditText(input.ItemNumber)))
	}
	if current.Category != input.Category {
		changes = append(changes, fmt.Sprintf("category: %s → %s", auditText(current.Category), auditText(input.Category)))
	}
	if current.Price != input.Price {
		changes = append(changes, fmt.Sprintf("salePrice: %.2f → %.2f", current.Price, input.Price))
	}
	if current.CostPrice != input.CostPrice {
		changes = append(changes, fmt.Sprintf("costPrice: %.2f → %.2f", current.CostPrice, input.CostPrice))
	}
	if current.Status != input.Status {
		changes = append(changes, fmt.Sprintf("status: %s → %s", auditText(current.Status), auditText(input.Status)))
	}
	if len(changes) == 0 {
		return "关键字段无变化"
	}
	return strings.Join(changes, "；")
}

func (s *AdminService) CreateProduct(ctx context.Context, actor domain.Account, input ProductInput) (domain.Product, error) {
	if !Can(actor, "products.edit") {
		return domain.Product{}, ErrForbidden
	}
	input.Code = ""
	if !normalizeProduct(&input) {
		return domain.Product{}, ErrInvalidInput
	}
	if !Can(actor, "finance.cost.view") {
		input.CostPrice = 0
	}
	input.ItemNumberManaged = true
	id, err := s.repo.CreateProduct(ctx, actor, input)
	if err != nil {
		return domain.Product{}, err
	}
	item, err := s.repo.Product(ctx, actor.StoreID, id)
	if err == nil && !Can(actor, "finance.cost.view") {
		item.CostPrice = 0
	}
	return item, err
}
func (s *AdminService) UpdateProduct(ctx context.Context, actor domain.Account, id int64, input ProductInput) (domain.Product, error) {
	if !Can(actor, "products.edit") {
		return domain.Product{}, ErrForbidden
	}
	if id <= 0 || !normalizeProduct(&input) {
		return domain.Product{}, ErrInvalidInput
	}
	current, err := s.repo.Product(ctx, actor.StoreID, id)
	if err != nil {
		return domain.Product{}, err
	}
	input.Code = current.Code
	if !Can(actor, "finance.cost.view") {
		input.CostPrice = current.CostPrice
	}
	input.ItemNumberManaged = current.ItemNumberManaged || input.ItemNumber != current.ItemNumber
	input.AuditSummary = productEditSummary(current, input)
	input.AuditAction, input.AuditRisk = "编辑商品", "normal"
	if current.Status != input.Status {
		input.AuditRisk = "warning"
		if domain.IsProductActiveStatus(input.Status) {
			input.AuditAction = "重新启用商品"
		} else {
			input.AuditAction = "停用商品"
		}
	}
	if err := s.repo.UpdateProduct(ctx, actor, id, input); err != nil {
		return domain.Product{}, err
	}
	item, err := s.repo.Product(ctx, actor.StoreID, id)
	if err == nil && !Can(actor, "finance.cost.view") {
		item.CostPrice = 0
	}
	return item, err
}
func (s *AdminService) DeleteProduct(ctx context.Context, actor domain.Account, id int64) error {
	if !Can(actor, "products.edit") {
		return ErrForbidden
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteProduct(ctx, actor, id)
}
func (s *AdminService) Inventory(ctx context.Context, actor domain.Account) ([]domain.Product, []domain.InventoryOperation, error) {
	if !Can(actor, "inventory.view") {
		return nil, nil, ErrForbidden
	}
	items, err := s.repo.Products(ctx, actor.StoreID)
	if err != nil {
		return nil, nil, err
	}
	if !Can(actor, "finance.cost.view") {
		for i := range items {
			items[i].CostPrice = 0
		}
	}
	operations, err := s.repo.InventoryOperations(ctx, actor.StoreID)
	return items, operations, err
}
func (s *AdminService) AdjustStock(ctx context.Context, actor domain.Account, input StockAdjustmentInput) error {
	input.Reason = strings.TrimSpace(input.Reason)
	if !Can(actor, "inventory.adjust") {
		return ErrForbidden
	}
	if input.ProductID <= 0 || input.QuantityChange == 0 || input.Reason == "" {
		return ErrInvalidInput
	}
	product, err := s.repo.Product(ctx, actor.StoreID, input.ProductID)
	if err != nil {
		return err
	}
	if !domain.IsProductActiveStatus(product.Status) {
		return domain.ErrProductInactive
	}
	return s.repo.AdjustStock(ctx, actor, input)
}
func (s *AdminService) CreateSale(ctx context.Context, actor domain.Account, input SaleInput) (domain.Sale, error) {
	input.PaymentMethod = strings.TrimSpace(input.PaymentMethod)
	if !Can(actor, "sales.edit") {
		return domain.Sale{}, ErrForbidden
	}
	if input.ProductID <= 0 || input.Quantity <= 0 || input.UnitPrice < 0 || input.PaymentMethod == "" {
		return domain.Sale{}, ErrInvalidInput
	}
	product, err := s.repo.Product(ctx, actor.StoreID, input.ProductID)
	if err != nil {
		return domain.Sale{}, err
	}
	if !domain.IsProductActiveStatus(product.Status) {
		return domain.Sale{}, domain.ErrProductInactive
	}
	id, err := s.repo.CreateSale(ctx, actor, input)
	if err != nil {
		return domain.Sale{}, err
	}
	items, err := s.repo.Sales(ctx, actor.StoreID)
	if err != nil {
		return domain.Sale{}, err
	}
	for _, item := range items {
		if item.ID == id {
			if !Can(actor, "finance.cost.view") {
				item.CostAmount = 0
			}
			if !Can(actor, "finance.profit.view") {
				item.Profit = 0
			}
			return item, nil
		}
	}
	return domain.Sale{}, ErrInvalidInput
}
func (s *AdminService) ReverseSale(ctx context.Context, actor domain.Account, id int64, reason string) error {
	if !Can(actor, "sales.edit") {
		return ErrForbidden
	}
	if id <= 0 || strings.TrimSpace(reason) == "" {
		return ErrInvalidInput
	}
	return s.repo.ReverseSale(ctx, actor, id, strings.TrimSpace(reason))
}
func (s *AdminService) CreateFinanceEntry(ctx context.Context, actor domain.Account, input FinanceEntryInput) error {
	input.Category, input.Note, input.BusinessType = strings.TrimSpace(input.Category), strings.TrimSpace(input.Note), strings.TrimSpace(input.BusinessType)
	if !Can(actor, "finance.entry.edit") {
		return ErrForbidden
	}
	if (input.EntryType != "income" && input.EntryType != "expense") || input.Category == "" || input.Amount <= 0 {
		return ErrInvalidInput
	}
	if input.BusinessType == "" {
		input.BusinessType = "全部"
	}
	if input.OccurredOn == "" {
		input.OccurredOn = s.now().In(businessLocation).Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", input.OccurredOn); err != nil {
		return ErrInvalidInput
	}
	_, err := s.repo.CreateFinanceEntry(ctx, actor, input)
	return err
}
func (s *AdminService) ReverseFinanceEntry(ctx context.Context, actor domain.Account, id int64, reason string) error {
	if !Can(actor, "finance.entry.edit") {
		return ErrForbidden
	}
	if id <= 0 || strings.TrimSpace(reason) == "" {
		return ErrInvalidInput
	}
	return s.repo.ReverseFinanceEntry(ctx, actor, id, strings.TrimSpace(reason))
}
func (s *AdminService) Settings(ctx context.Context, actor domain.Account) ([]domain.Setting, error) {
	if !Can(actor, "system.settings.manage") {
		return nil, ErrForbidden
	}
	return s.repo.Settings(ctx, actor.StoreID)
}
func (s *AdminService) UpsertSetting(ctx context.Context, actor domain.Account, input SettingInput) error {
	input.Group, input.Key, input.Label, input.Value = strings.TrimSpace(input.Group), strings.TrimSpace(input.Key), strings.TrimSpace(input.Label), strings.TrimSpace(input.Value)
	if !Can(actor, "system.settings.manage") {
		return ErrForbidden
	}
	if input.Group == "" || input.Key == "" || input.Label == "" {
		return ErrInvalidInput
	}
	return s.repo.UpsertSetting(ctx, actor, input)
}
func (s *AdminService) AuditLogs(ctx context.Context, actor domain.Account) ([]domain.AuditLog, error) {
	if !Can(actor, "system.audit.view") {
		return nil, ErrForbidden
	}
	return s.repo.AuditLogs(ctx, actor.StoreID)
}
