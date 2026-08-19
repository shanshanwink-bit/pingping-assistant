package domain

type Purchase struct {
	RecordID     string  `json:"recordId"`
	ProductName  string  `json:"productName"`
	BusinessType string  `json:"businessType"`
	SpecText     string  `json:"specText"`
	Quantity     int     `json:"quantity"`
	UnitCost     float64 `json:"unitCost"`
	TotalCost    float64 `json:"totalCost"`
	Supplier     string  `json:"supplier"`
	Note         string  `json:"note"`
	OperatorName string  `json:"operatorName"`
	Status       string  `json:"status"`
	Source       string  `json:"source"`
	CreatedAt    string  `json:"createdAt"`
}

type OperatingData struct {
	Source    string           `json:"source"`
	Sales     []Sale           `json:"sales"`
	Purchases []Purchase       `json:"purchases"`
	Entries   []FinanceEntry   `json:"entries"`
	Summary   OperatingSummary `json:"summary"`
}

type OperatingSummary struct {
	Revenue          float64 `json:"revenue"`
	Cost             float64 `json:"cost"`
	GrossProfit      float64 `json:"grossProfit"`
	OtherIncome      float64 `json:"otherIncome"`
	OtherExpense     float64 `json:"otherExpense"`
	OperatingProfit  float64 `json:"operatingProfit"`
	PurchaseExpense  float64 `json:"purchaseExpense"`
	SalesCount       int     `json:"salesCount"`
	SoldQuantity     int     `json:"soldQuantity"`
	MissingCostSales int     `json:"missingCostSales"`
}
