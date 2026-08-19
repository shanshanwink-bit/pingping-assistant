package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"pingping-assistant-admin/internal/domain"
)

type miniState struct {
	Sales        []miniSale     `json:"sales"`
	Purchases    []miniPurchase `json:"purchases"`
	ManualProfit []miniEntry    `json:"manualProfits"`
}

type miniSale struct {
	ID, ProductID, ProductName, BusinessType, SpecText string
	PaymentMethod, Note, Operator, CreatedAt           string
	Quantity                                           int
	UnitPrice                                          float64
	TotalAmount                                        float64
	TotalCost                                          *float64
	GrossProfit                                        *float64
}

type miniPurchase struct {
	ID, ProductName, BusinessType, SpecText string
	Supplier, Note, Operator, CreatedAt     string
	Quantity                                int
	UnitCost, TotalCost                     float64
}

type miniEntry struct {
	ID, EntryType, BusinessType, Date string
	Note, Operator, CreatedAt         string
	Amount                            float64
}

func (r *AdminRepository) OperatingData(ctx context.Context, storeID string) (domain.OperatingData, error) {
	var raw []byte
	err := r.db.QueryRowContext(ctx, `SELECT state FROM store_states WHERE store_id=?`, storeID).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		return domain.OperatingData{}, err
	}
	if err == nil {
		data, active, decodeErr := decodeMiniOperatingData(raw)
		if decodeErr != nil {
			return domain.OperatingData{}, decodeErr
		}
		if active {
			return data, nil
		}
	}
	return r.legacyOperatingData(ctx, storeID)
}

func decodeMiniOperatingData(raw []byte) (domain.OperatingData, bool, error) {
	var state miniState
	if err := json.Unmarshal(raw, &state); err != nil {
		return domain.OperatingData{}, false, fmt.Errorf("decode store state: %w", err)
	}
	active := len(state.Sales)+len(state.Purchases)+len(state.ManualProfit) > 0
	data := domain.OperatingData{Source: "微信小程序", Sales: []domain.Sale{}, Purchases: []domain.Purchase{}, Entries: []domain.FinanceEntry{}}
	for _, item := range state.Sales {
		data.Sales = append(data.Sales, miniSaleRecord(item))
	}
	for _, item := range state.Purchases {
		data.Purchases = append(data.Purchases, miniPurchaseRecord(item))
	}
	for _, item := range state.ManualProfit {
		data.Entries = append(data.Entries, miniEntryRecord(item))
	}
	return data, active, nil
}

func miniSaleRecord(item miniSale) domain.Sale {
	cost, profit, hasCost := 0.0, 0.0, item.TotalCost != nil && item.GrossProfit != nil
	if hasCost {
		cost, profit = *item.TotalCost, *item.GrossProfit
	}
	productID, _ := strconv.ParseInt(item.ProductID, 10, 64)
	return domain.Sale{
		RecordID: item.ID, OrderNo: item.ID, ProductID: productID, ProductName: item.ProductName,
		BusinessType: businessTypeName(item.BusinessType), SpecText: item.SpecText, Quantity: item.Quantity,
		UnitPrice: item.UnitPrice, Amount: item.TotalAmount, CostAmount: cost, Profit: profit,
		PaymentMethod: item.PaymentMethod, Note: item.Note, OperatorName: item.Operator,
		Status: "effective", Source: "微信小程序", HasCost: hasCost, CreatedAt: item.CreatedAt,
	}
}

func miniPurchaseRecord(item miniPurchase) domain.Purchase {
	return domain.Purchase{
		RecordID: item.ID, ProductName: item.ProductName, BusinessType: businessTypeName(item.BusinessType),
		SpecText: item.SpecText, Quantity: item.Quantity, UnitCost: item.UnitCost, TotalCost: item.TotalCost,
		Supplier: item.Supplier, Note: item.Note, OperatorName: item.Operator, Status: "effective",
		Source: "微信小程序", CreatedAt: item.CreatedAt,
	}
}

func miniEntryRecord(item miniEntry) domain.FinanceEntry {
	entryType := item.EntryType
	if entryType == "" {
		if item.Amount < 0 {
			entryType = "expense"
		} else {
			entryType = "income"
		}
	}
	amount := item.Amount
	if amount < 0 {
		amount = -amount
	}
	date := item.Date
	if date == "" && len(item.CreatedAt) >= 10 {
		date = item.CreatedAt[:10]
	}
	return domain.FinanceEntry{
		RecordID: item.ID, EntryType: entryType, Category: entryCategory(entryType), Amount: amount,
		BusinessType: businessTypeName(item.BusinessType), Note: item.Note, Status: "effective",
		OperatorName: item.Operator, Source: "微信小程序", OccurredOn: date, CreatedAt: item.CreatedAt,
	}
}

func (r *AdminRepository) legacyOperatingData(ctx context.Context, storeID string) (domain.OperatingData, error) {
	sales, err := r.Sales(ctx, storeID)
	if err != nil {
		return domain.OperatingData{}, err
	}
	entries, err := r.FinanceEntries(ctx, storeID)
	if err != nil {
		return domain.OperatingData{}, err
	}
	for i := range sales {
		sales[i].RecordID = fmt.Sprintf("admin-sale-%d", sales[i].ID)
		sales[i].Source = "管理后台"
		sales[i].HasCost = sales[i].CostAmount > 0
		if !sales[i].HasCost {
			sales[i].Profit = 0
		}
	}
	for i := range entries {
		entries[i].RecordID = fmt.Sprintf("admin-entry-%d", entries[i].ID)
		entries[i].Source = "管理后台"
	}
	return domain.OperatingData{Source: "管理后台历史", Sales: sales, Purchases: []domain.Purchase{}, Entries: entries}, nil
}

func businessTypeName(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "clothing", "服装":
		return "服装"
	case "cosmetics", "化妆品":
		return "化妆品"
	default:
		return "全部"
	}
}

func entryCategory(entryType string) string {
	if entryType == "expense" {
		return "其他支出"
	}
	return "其他收入"
}
