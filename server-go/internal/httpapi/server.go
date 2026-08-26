package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pingping-assistant-admin/internal/domain"
	"pingping-assistant-admin/internal/service"
)

type API struct {
	db            *sql.DB
	service       *service.AdminService
	productImages ProductImageOptions
}

func NewServer(address string, db *sql.DB, adminService *service.AdminService, imageOptions ...ProductImageOptions) *http.Server {
	images := defaultProductImageOptions()
	if len(imageOptions) > 0 {
		images = normalizeProductImageOptions(imageOptions[0])
	}
	api := &API{db: db, service: adminService, productImages: images}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin-api/v1/health", api.health)
	mux.HandleFunc("POST /admin-api/v1/auth/login", api.login)
	mux.HandleFunc("POST /admin-api/v1/auth/logout", api.withAuth(api.logout))
	mux.HandleFunc("GET /admin-api/v1/auth/me", api.withAuth(api.me))
	mux.HandleFunc("PATCH /admin-api/v1/auth/profile", api.withAuth(api.updateProfile))
	mux.HandleFunc("GET /admin-api/v1/dashboard", api.withAuth(api.dashboard))
	mux.HandleFunc("GET /admin-api/v1/products", api.withAuth(api.products))
	mux.HandleFunc("POST /admin-api/v1/product-images", api.withAuth(api.uploadProductImage))
	mux.Handle("GET "+images.URLPrefix+"/", api.serveProductImages())
	mux.HandleFunc("POST /admin-api/v1/products", api.withAuth(api.createProduct))
	mux.HandleFunc("PATCH /admin-api/v1/products/{id}", api.withAuth(api.updateProduct))
	mux.HandleFunc("GET /admin-api/v1/products/{id}/deletion-eligibility", api.withAuth(api.productDeletionEligibility))
	mux.HandleFunc("DELETE /admin-api/v1/products/{id}", api.withAuth(api.deleteProduct))
	mux.HandleFunc("GET /admin-api/v1/inventory", api.withAuth(api.inventory))
	mux.HandleFunc("POST /admin-api/v1/inventory/adjustments", api.withAuth(api.adjustStock))
	mux.HandleFunc("GET /admin-api/v1/sales-finance", api.withAuth(api.salesFinance))
	mux.HandleFunc("POST /admin-api/v1/sales", api.withAuth(api.createSale))
	mux.HandleFunc("POST /admin-api/v1/sales/{id}/reverse", api.withAuth(api.reverseSale))
	mux.HandleFunc("POST /admin-api/v1/finance-entries", api.withAuth(api.createFinanceEntry))
	mux.HandleFunc("POST /admin-api/v1/finance-entries/{id}/reverse", api.withAuth(api.reverseFinanceEntry))
	mux.HandleFunc("GET /admin-api/v1/analysis", api.withAuth(api.analysis))
	mux.HandleFunc("GET /admin-api/v1/settings", api.withAuth(api.settings))
	mux.HandleFunc("PUT /admin-api/v1/settings", api.withAuth(api.upsertSetting))
	mux.HandleFunc("GET /admin-api/v1/audit-logs", api.withAuth(api.auditLogs))
	mux.HandleFunc("GET /admin-api/v1/employees", api.withAuth(api.employees))
	mux.HandleFunc("POST /admin-api/v1/employees", api.withAuth(api.createEmployee))
	mux.HandleFunc("PATCH /admin-api/v1/employees/{id}", api.withAuth(api.updateEmployee))
	mux.HandleFunc("DELETE /admin-api/v1/employees/{id}", api.withAuth(api.deleteEmployee))
	return &http.Server{
		Addr: address, Handler: SecurityHeaders(mux), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second,
	}
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status := http.StatusInternalServerError
	message := "服务暂时不可用，请稍后重试"
	code := ""
	switch {
	case errors.Is(err, service.ErrUnauthorized):
		status, message = http.StatusUnauthorized, err.Error()
	case errors.Is(err, service.ErrInvalidCredentials):
		status, message = http.StatusUnauthorized, err.Error()
	case errors.Is(err, service.ErrForbidden):
		status, message = http.StatusForbidden, err.Error()
	case errors.Is(err, service.ErrProductDeleteForbidden):
		status, message, code = http.StatusForbidden, err.Error(), "PRODUCT_DELETE_FORBIDDEN"
	case errors.Is(err, service.ErrInvalidInput), errors.Is(err, service.ErrOwnerProtected), errors.Is(err, service.ErrSelfProtected):
		status, message = http.StatusBadRequest, err.Error()
	case errors.Is(err, domain.ErrProductInactive):
		status, message, code = http.StatusConflict, domain.ErrProductInactive.Error(), "PRODUCT_INACTIVE"
	case errors.Is(err, domain.ErrProductHasHistory):
		status, message, code = http.StatusConflict, err.Error(), "PRODUCT_HAS_HISTORY"
	case errors.Is(err, domain.ErrBusinessRule):
		status, message = http.StatusConflict, strings.TrimPrefix(err.Error(), domain.ErrBusinessRule.Error()+": ")
	case errors.Is(err, sql.ErrNoRows):
		status, message = http.StatusNotFound, "没有找到对应记录"
	}
	requestID := requestID(r)
	payload := map[string]any{"ok": false, "message": message, "requestId": requestID}
	if code != "" {
		payload["code"] = code
	}
	if reasons := domain.ProductDeletionReasons(err); len(reasons) > 0 {
		payload["reasons"] = reasons
	}
	writeJSON(w, status, payload)
}

func requestID(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Request-Id"))
	if value == "" {
		value = strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	if len(value) > 80 {
		return value[:80]
	}
	return value
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, r, service.ErrInvalidInput)
		return false
	}
	return true
}

func bearerToken(r *http.Request) string {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

type authenticatedHandler func(http.ResponseWriter, *http.Request, domain.Account, string)

func (a *API) withAuth(next authenticatedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		account, err := a.service.Authenticate(r.Context(), token)
		if err != nil {
			writeError(w, r, err)
			return
		}
		next(w, r, account, token)
	}
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if err := a.db.PingContext(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "service": "pingping-admin-api", "database": "disconnected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "pingping-admin-api", "database": "connected", "time": time.Now().UTC()})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	token, account, err := a.service.Login(r.Context(), input.Username, input.Password)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": token, "user": account})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request, _ domain.Account, token string) {
	if err := a.service.Logout(r.Context(), token); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) me(w http.ResponseWriter, _ *http.Request, account domain.Account, _ string) {
	writeJSON(w, http.StatusOK, map[string]any{"user": account})
}

func (a *API) updateProfile(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.UpdateProfileInput
	if !decodeJSON(w, r, &input) {
		return
	}
	updated, err := a.service.UpdateProfile(r.Context(), account, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (a *API) dashboard(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	result, err := a.service.Dashboard(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dashboardPayload(result))
}

func dashboardPayload(result domain.Dashboard) map[string]any {
	payload := map[string]any{
		"updatedAt": result.UpdatedAt, "salesAmount": result.SalesAmount,
		"soldQuantity": result.SoldQuantity, "salesCount": result.SalesCount,
		"inventoryQuantity": result.InventoryQuantity, "missingCostSales": result.MissingCostSales,
		"canViewCost": result.CanViewCost, "canViewProfit": result.CanViewProfit,
	}
	if result.CanViewCost {
		payload["soldCost"], payload["inventoryCost"] = result.SoldCost, result.InventoryCost
	}
	if result.CanViewProfit {
		payload["profit"], payload["otherIncome"], payload["otherExpense"] = result.Profit, result.OtherIncome, result.OtherExpense
		payload["purchaseExpense"], payload["trend"] = result.PurchaseExpense, result.Trend
	}
	return payload
}

func (a *API) products(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	items, err := a.service.Products(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items), "canViewCost": service.Can(account, "finance.cost.view")})
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, service.ErrInvalidInput
	}
	return id, nil
}

func (a *API) createProduct(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.ProductInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := a.service.CreateProduct(r.Context(), account, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": item})
}
func (a *API) updateProduct(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var input service.ProductInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.RequestID = requestID(r)
	item, err := a.service.UpdateProduct(r.Context(), account, id, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}
func (a *API) deleteProduct(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err = a.service.DeleteProduct(r.Context(), account, domain.ProductDeletionInput{
		ProductID: id,
		RequestID: requestID(r),
	}); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) productDeletionEligibility(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	result, err := a.service.ProductDeletionEligibility(r.Context(), account, id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (a *API) inventory(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	items, ops, err := a.service.Inventory(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "operations": ops, "canViewCost": service.Can(account, "finance.cost.view")})
}
func (a *API) adjustStock(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.StockAdjustmentInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := a.service.AdjustStock(r.Context(), account, input); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}
func (a *API) salesFinance(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	data, err := a.service.SalesAndFinance(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"source": data.Source, "sales": data.Sales, "entries": data.Entries, "purchases": data.Purchases, "summary": data.Summary,
		"canViewCost": service.Can(account, "finance.cost.view"), "canViewProfit": service.Can(account, "finance.profit.view"),
	})
}
func (a *API) createSale(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.SaleInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := a.service.CreateSale(r.Context(), account, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": item})
}
func decodeReason(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return "", false
	}
	return input.Reason, true
}
func (a *API) reverseSale(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	reason, ok := decodeReason(w, r)
	if !ok {
		return
	}
	if err = a.service.ReverseSale(r.Context(), account, id, reason); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *API) createFinanceEntry(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.FinanceEntryInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := a.service.CreateFinanceEntry(r.Context(), account, input); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}
func (a *API) reverseFinanceEntry(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	reason, ok := decodeReason(w, r)
	if !ok {
		return
	}
	if err = a.service.ReverseFinanceEntry(r.Context(), account, id, reason); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *API) analysis(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	q := r.URL.Query()
	result, err := a.service.Analysis(r.Context(), account, q.Get("from"), q.Get("to"), q.Get("businessType"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (a *API) settings(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	items, err := a.service.Settings(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (a *API) upsertSetting(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.SettingInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := a.service.UpsertSetting(r.Context(), account, input); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *API) auditLogs(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	items, err := a.service.AuditLogs(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) employees(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	employees, roles, err := a.service.Employees(r.Context(), account)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": employees, "roles": roles})
}

func (a *API) createEmployee(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	var input service.CreateEmployeeInput
	if !decodeJSON(w, r, &input) {
		return
	}
	employee, err := a.service.CreateEmployee(r.Context(), account, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": employee})
}

func (a *API) updateEmployee(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, r, service.ErrInvalidInput)
		return
	}
	var input service.UpdateEmployeeInput
	if !decodeJSON(w, r, &input) {
		return
	}
	employee, err := a.service.UpdateEmployee(r.Context(), account, id, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": employee})
}

func (a *API) deleteEmployee(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err = a.service.DeleteEmployee(r.Context(), account, id, input.Reason); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
