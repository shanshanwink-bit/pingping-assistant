package service

import (
	"context"
	"strings"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type ProductInput = domain.ProductInput
type StockAdjustmentInput = domain.StockAdjustmentInput
type SaleInput = domain.SaleInput
type FinanceEntryInput = domain.FinanceEntryInput
type SettingInput = domain.SettingInput

func normalizeProduct(input *ProductInput) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.Category, input.Location, input.Image = strings.TrimSpace(input.Category), strings.TrimSpace(input.Location), strings.TrimSpace(input.Image)
	if input.Status == "" {
		input.Status = "销售中"
	}
	return input.Name != "" && (input.BusinessType == "服装" || input.BusinessType == "化妆品") &&
		input.Category != "" && input.SpecCount >= 0 && input.CostPrice >= 0 && input.Price >= 0 && input.LowStockThreshold >= 0 &&
		(input.Status == "销售中" || input.Status == "已停用")
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
