package service

import (
	"context"
	"sort"
	"strings"
	"time"

	"pingping-assistant-admin/internal/domain"
)

var businessLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func (s *AdminService) Dashboard(ctx context.Context, actor domain.Account) (domain.Dashboard, error) {
	if !Can(actor, "dashboard.view") {
		return domain.Dashboard{}, ErrForbidden
	}
	data, err := s.repo.OperatingData(ctx, actor.StoreID)
	if err != nil {
		return domain.Dashboard{}, err
	}
	products, err := s.repo.Products(ctx, actor.StoreID)
	if err != nil {
		return domain.Dashboard{}, err
	}
	now := s.now().In(businessLocation)
	today := now.Format("2006-01-02")
	analysis := aggregateOperating(data, today, today, "全部")
	result := domain.Dashboard{
		UpdatedAt: now.Format("15:04"), SalesAmount: analysis.Revenue, SoldCost: analysis.Cost,
		Profit: analysis.OperatingProfit, OtherIncome: analysis.OtherIncome, OtherExpense: analysis.OtherExpense,
		PurchaseExpense: analysis.PurchaseExpense, MissingCostSales: analysis.MissingCostSales,
		SoldQuantity: analysis.SoldQuantity, SalesCount: analysis.SalesCount,
		Trend: sevenDayProfit(data, now), Tasks: []domain.TaskItem{}, Risks: []domain.RiskItem{},
		CanViewCost: Can(actor, "finance.cost.view"), CanViewProfit: Can(actor, "finance.profit.view"),
	}
	for _, product := range products {
		result.InventoryQuantity += product.Stock
		result.InventoryCost += float64(product.Stock) * product.CostPrice
	}
	if !result.CanViewCost {
		result.SoldCost, result.InventoryCost = 0, 0
	}
	if !result.CanViewProfit {
		result.Profit, result.OtherIncome, result.OtherExpense, result.PurchaseExpense = 0, 0, 0, 0
		result.Trend = make([]float64, 7)
	}
	return result, nil
}

func (s *AdminService) SalesAndFinance(ctx context.Context, actor domain.Account) (domain.OperatingData, error) {
	if !Can(actor, "sales.view") {
		return domain.OperatingData{}, ErrForbidden
	}
	data, err := s.repo.OperatingData(ctx, actor.StoreID)
	if err != nil {
		return domain.OperatingData{}, err
	}
	analysis := aggregateOperating(data, "", "", "全部")
	data.Summary = summaryFromAnalysis(analysis)
	canCost, canProfit := Can(actor, "finance.cost.view"), Can(actor, "finance.profit.view")
	for i := range data.Sales {
		if !canCost {
			data.Sales[i].CostAmount = 0
		}
		if !canProfit {
			data.Sales[i].Profit = 0
		}
	}
	if !canCost {
		data.Purchases = []domain.Purchase{}
		data.Summary.Cost, data.Summary.PurchaseExpense = 0, 0
	}
	if !canProfit {
		data.Entries = []domain.FinanceEntry{}
		data.Summary.GrossProfit, data.Summary.OtherIncome, data.Summary.OtherExpense, data.Summary.OperatingProfit = 0, 0, 0, 0
	}
	return data, nil
}

func (s *AdminService) Analysis(ctx context.Context, actor domain.Account, from, to, businessType string) (domain.Analysis, error) {
	if !Can(actor, "finance.profit.view") {
		return domain.Analysis{}, ErrForbidden
	}
	now := s.now().In(businessLocation)
	if from == "" {
		from = now.AddDate(0, 0, -29).Format("2006-01-02")
	}
	if to == "" {
		to = now.Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", from); err != nil {
		return domain.Analysis{}, ErrInvalidInput
	}
	if _, err := time.Parse("2006-01-02", to); err != nil || from > to {
		return domain.Analysis{}, ErrInvalidInput
	}
	data, err := s.repo.OperatingData(ctx, actor.StoreID)
	if err != nil {
		return domain.Analysis{}, err
	}
	result := aggregateOperating(data, from, to, businessType)
	result.CanViewCost = Can(actor, "finance.cost.view")
	if !result.CanViewCost {
		result.Cost = 0
	}
	return result, nil
}

func aggregateOperating(data domain.OperatingData, from, to, businessType string) domain.Analysis {
	result := domain.Analysis{Trend: []domain.AnalysisPoint{}, Products: []domain.ProductPerformance{}, Payments: []domain.PaymentPerformance{}}
	daily := map[string]*domain.AnalysisPoint{}
	products := map[string]*domain.ProductPerformance{}
	payments := map[string]float64{}
	pricedRevenue := 0.0
	for _, sale := range data.Sales {
		date := recordDate(sale.CreatedAt)
		if sale.Status != "effective" || !included(date, sale.BusinessType, from, to, businessType) {
			continue
		}
		result.Revenue += sale.Amount
		result.SalesCount++
		result.SoldQuantity += sale.Quantity
		point := pointFor(daily, date)
		point.Revenue += sale.Amount
		item := productFor(products, sale.ProductName)
		item.Quantity += sale.Quantity
		item.Revenue += sale.Amount
		payments[sale.PaymentMethod] += sale.Amount
		if sale.HasCost {
			result.Cost += sale.CostAmount
			result.GrossProfit += sale.Profit
			pricedRevenue += sale.Amount
			point.Profit += sale.Profit
			item.Profit += sale.Profit
		} else {
			result.MissingCostSales++
		}
	}
	for _, entry := range data.Entries {
		date := entry.OccurredOn
		if date == "" {
			date = recordDate(entry.CreatedAt)
		}
		if entry.Status != "effective" || !included(date, entry.BusinessType, from, to, businessType) {
			continue
		}
		point := pointFor(daily, date)
		if entry.EntryType == "expense" {
			result.OtherExpense += entry.Amount
			point.Profit -= entry.Amount
		} else {
			result.OtherIncome += entry.Amount
			point.Profit += entry.Amount
		}
	}
	for _, purchase := range data.Purchases {
		if purchase.Status == "effective" && included(recordDate(purchase.CreatedAt), purchase.BusinessType, from, to, businessType) {
			result.PurchaseExpense += purchase.TotalCost
		}
	}
	result.OperatingProfit = result.GrossProfit + result.OtherIncome - result.OtherExpense
	if pricedRevenue > 0 {
		result.GrossMargin = result.GrossProfit / pricedRevenue * 100
	}
	if result.SalesCount > 0 {
		result.AverageOrder = result.Revenue / float64(result.SalesCount)
	}
	result.Trend = sortedTrend(daily)
	result.Products = sortedProducts(products)
	result.Payments = sortedPayments(payments)
	return result
}

func included(date, recordType, from, to, filterType string) bool {
	if len(date) != 10 || (from != "" && date < from) || (to != "" && date > to) {
		return false
	}
	return filterType == "" || filterType == "全部" || recordType == filterType
}

func recordDate(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return ""
}

func pointFor(points map[string]*domain.AnalysisPoint, date string) *domain.AnalysisPoint {
	if points[date] == nil {
		points[date] = &domain.AnalysisPoint{Date: date}
	}
	return points[date]
}

func productFor(items map[string]*domain.ProductPerformance, name string) *domain.ProductPerformance {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "未命名商品"
	}
	if items[name] == nil {
		items[name] = &domain.ProductPerformance{Name: name}
	}
	return items[name]
}

func sortedTrend(items map[string]*domain.AnalysisPoint) []domain.AnalysisPoint {
	result := make([]domain.AnalysisPoint, 0, len(items))
	for _, item := range items {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Date < result[j].Date })
	return result
}

func sortedProducts(items map[string]*domain.ProductPerformance) []domain.ProductPerformance {
	result := make([]domain.ProductPerformance, 0, len(items))
	for _, item := range items {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Profit == result[j].Profit {
			return result[i].Revenue > result[j].Revenue
		}
		return result[i].Profit > result[j].Profit
	})
	if len(result) > 10 {
		result = result[:10]
	}
	return result
}

func sortedPayments(items map[string]float64) []domain.PaymentPerformance {
	result := make([]domain.PaymentPerformance, 0, len(items))
	for name, amount := range items {
		if strings.TrimSpace(name) == "" {
			name = "未记录"
		}
		result = append(result, domain.PaymentPerformance{Name: name, Amount: amount})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Amount > result[j].Amount })
	return result
}

func sevenDayProfit(data domain.OperatingData, now time.Time) []float64 {
	from := now.AddDate(0, 0, -6).Format("2006-01-02")
	to := now.Format("2006-01-02")
	analysis := aggregateOperating(data, from, to, "全部")
	byDate := map[string]float64{}
	for _, point := range analysis.Trend {
		byDate[point.Date] = point.Profit
	}
	result := make([]float64, 0, 7)
	for i := 6; i >= 0; i-- {
		result = append(result, byDate[now.AddDate(0, 0, -i).Format("2006-01-02")])
	}
	return result
}

func summaryFromAnalysis(item domain.Analysis) domain.OperatingSummary {
	return domain.OperatingSummary{
		Revenue: item.Revenue, Cost: item.Cost, GrossProfit: item.GrossProfit,
		OtherIncome: item.OtherIncome, OtherExpense: item.OtherExpense, OperatingProfit: item.OperatingProfit,
		PurchaseExpense: item.PurchaseExpense, SalesCount: item.SalesCount, SoldQuantity: item.SoldQuantity,
		MissingCostSales: item.MissingCostSales,
	}
}
