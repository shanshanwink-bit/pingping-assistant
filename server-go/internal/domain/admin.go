package domain

import (
	"errors"
	"time"
)

var ErrBusinessRule = errors.New("业务规则校验失败")
var ErrProductInactive = errors.New("商品已停用，请先重新启用")

type Account struct {
	ID           int64    `json:"id"`
	StoreID      string   `json:"-"`
	Username     string   `json:"username"`
	DisplayName  string   `json:"displayName"`
	AvatarURL    string   `json:"avatarUrl"`
	Role         string   `json:"role"`
	RoleName     string   `json:"roleName"`
	Status       string   `json:"status"`
	Permissions  []string `json:"permissions"`
	PasswordHash string   `json:"-"`
}

type Employee struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	Role        string     `json:"role"`
	RoleName    string     `json:"roleName"`
	Status      string     `json:"status"`
	Permissions []string   `json:"permissions"`
	LastLoginAt *time.Time `json:"lastLoginAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Role struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
	MemberCount int      `json:"memberCount"`
}

type Product struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	Code              string  `json:"code"`
	ItemNumber        string  `json:"itemNumber"`
	ItemNumberManaged bool    `json:"itemNumberManaged"`
	BusinessType      string  `json:"businessType"`
	Category          string  `json:"category"`
	SpecCount         int     `json:"specCount"`
	Stock             int     `json:"stock"`
	CostPrice         float64 `json:"costPrice"`
	LowStockThreshold int     `json:"lowStockThreshold"`
	Location          string  `json:"location"`
	Price             float64 `json:"price"`
	Status            string  `json:"status"`
	UpdatedAt         string  `json:"updatedAt"`
	Image             string  `json:"image"`
}

type InventoryOperation struct {
	ID             int64  `json:"id"`
	ProductID      int64  `json:"productId"`
	ProductName    string `json:"productName"`
	OperationType  string `json:"operationType"`
	BeforeStock    int    `json:"beforeStock"`
	QuantityChange int    `json:"quantityChange"`
	AfterStock     int    `json:"afterStock"`
	Reason         string `json:"reason"`
	OperatorName   string `json:"operatorName"`
	CreatedAt      string `json:"createdAt"`
}

type Sale struct {
	ID            int64   `json:"id"`
	RecordID      string  `json:"recordId"`
	OrderNo       string  `json:"orderNo"`
	ProductID     int64   `json:"productId"`
	ProductName   string  `json:"productName"`
	BusinessType  string  `json:"businessType"`
	Quantity      int     `json:"quantity"`
	UnitPrice     float64 `json:"unitPrice"`
	Amount        float64 `json:"amount"`
	CostAmount    float64 `json:"costAmount"`
	Profit        float64 `json:"profit"`
	PaymentMethod string  `json:"paymentMethod"`
	Status        string  `json:"status"`
	OperatorName  string  `json:"operatorName"`
	Reason        string  `json:"reason"`
	SpecText      string  `json:"specText"`
	Note          string  `json:"note"`
	Source        string  `json:"source"`
	HasCost       bool    `json:"hasCost"`
	CreatedAt     string  `json:"createdAt"`
}

type FinanceEntry struct {
	ID           int64   `json:"id"`
	RecordID     string  `json:"recordId"`
	EntryType    string  `json:"entryType"`
	Category     string  `json:"category"`
	Amount       float64 `json:"amount"`
	BusinessType string  `json:"businessType"`
	Note         string  `json:"note"`
	Status       string  `json:"status"`
	OperatorName string  `json:"operatorName"`
	Source       string  `json:"source"`
	OccurredOn   string  `json:"occurredOn"`
	CreatedAt    string  `json:"createdAt"`
}

type Analysis struct {
	CanViewCost      bool                 `json:"canViewCost"`
	Revenue          float64              `json:"revenue"`
	Cost             float64              `json:"cost"`
	GrossProfit      float64              `json:"grossProfit"`
	OperatingProfit  float64              `json:"operatingProfit"`
	GrossMargin      float64              `json:"grossMargin"`
	SalesCount       int                  `json:"salesCount"`
	SoldQuantity     int                  `json:"soldQuantity"`
	AverageOrder     float64              `json:"averageOrder"`
	OtherIncome      float64              `json:"otherIncome"`
	OtherExpense     float64              `json:"otherExpense"`
	PurchaseExpense  float64              `json:"purchaseExpense"`
	MissingCostSales int                  `json:"missingCostSales"`
	Trend            []AnalysisPoint      `json:"trend"`
	Products         []ProductPerformance `json:"products"`
	Payments         []PaymentPerformance `json:"payments"`
}

type AnalysisPoint struct {
	Date    string  `json:"date"`
	Revenue float64 `json:"revenue"`
	Profit  float64 `json:"profit"`
}
type ProductPerformance struct {
	Name     string  `json:"name"`
	Quantity int     `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Profit   float64 `json:"profit"`
}
type PaymentPerformance struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

type Setting struct {
	ID        int64  `json:"id"`
	Group     string `json:"group"`
	Key       string `json:"key"`
	Label     string `json:"label"`
	Value     string `json:"value"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}

type AuditLog struct {
	ID           int64  `json:"id"`
	OperatorName string `json:"operatorName"`
	OperatorRole string `json:"operatorRole"`
	Action       string `json:"action"`
	ObjectType   string `json:"objectType"`
	ObjectID     string `json:"objectId"`
	Summary      string `json:"summary"`
	Reason       string `json:"reason"`
	Source       string `json:"source"`
	RiskLevel    string `json:"riskLevel"`
	CreatedAt    string `json:"createdAt"`
}

type ProductInput struct {
	Name              string  `json:"name"`
	Code              string  `json:"code"`
	ItemNumber        string  `json:"itemNumber"`
	BusinessType      string  `json:"businessType"`
	Category          string  `json:"category"`
	SpecCount         int     `json:"specCount"`
	CostPrice         float64 `json:"costPrice"`
	LowStockThreshold int     `json:"lowStockThreshold"`
	Location          string  `json:"location"`
	Price             float64 `json:"price"`
	Status            string  `json:"status"`
	Image             string  `json:"image"`
	ItemNumberManaged bool    `json:"-"`
	AuditSummary      string  `json:"-"`
	AuditAction       string  `json:"-"`
	AuditRisk         string  `json:"-"`
	RequestID         string  `json:"-"`
}

type ProductDeletionInput struct {
	ProductID int64  `json:"-"`
	RequestID string `json:"-"`
}
type StockAdjustmentInput struct {
	ProductID      int64  `json:"productId"`
	QuantityChange int    `json:"quantityChange"`
	Reason         string `json:"reason"`
}
type SaleInput struct {
	ProductID     int64   `json:"productId"`
	Quantity      int     `json:"quantity"`
	UnitPrice     float64 `json:"unitPrice"`
	PaymentMethod string  `json:"paymentMethod"`
}
type FinanceEntryInput struct {
	EntryType    string  `json:"entryType"`
	Category     string  `json:"category"`
	Amount       float64 `json:"amount"`
	BusinessType string  `json:"businessType"`
	Note         string  `json:"note"`
	OccurredOn   string  `json:"occurredOn"`
}
type SettingInput struct {
	Group     string `json:"group"`
	Key       string `json:"key"`
	Label     string `json:"label"`
	Value     string `json:"value"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}

type TaskItem struct {
	Label string `json:"label"`
	Count int    `json:"count"`
	Tone  string `json:"tone"`
}
type RiskItem struct {
	Time     string `json:"time"`
	Action   string `json:"action"`
	Operator string `json:"operator"`
	Status   string `json:"status"`
	Tone     string `json:"tone"`
}

type Dashboard struct {
	UpdatedAt         string     `json:"updatedAt"`
	SalesAmount       float64    `json:"salesAmount"`
	SoldCost          float64    `json:"soldCost"`
	Profit            float64    `json:"profit"`
	OtherIncome       float64    `json:"otherIncome"`
	OtherExpense      float64    `json:"otherExpense"`
	PurchaseExpense   float64    `json:"purchaseExpense"`
	MissingCostSales  int        `json:"missingCostSales"`
	SoldQuantity      int        `json:"soldQuantity"`
	SalesCount        int        `json:"salesCount"`
	InventoryCost     float64    `json:"inventoryCost"`
	InventoryQuantity int        `json:"inventoryQuantity"`
	Trend             []float64  `json:"trend"`
	CanViewCost       bool       `json:"canViewCost"`
	CanViewProfit     bool       `json:"canViewProfit"`
	Tasks             []TaskItem `json:"tasks"`
	Risks             []RiskItem `json:"risks"`
}
