package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"pingping-assistant-admin/internal/domain"
)

var (
	ErrUnauthorized       = errors.New("登录已过期，请重新登录")
	ErrForbidden          = errors.New("当前账号没有此操作权限")
	ErrInvalidCredentials = errInvalidPassword
	ErrInvalidInput       = errors.New("提交内容不完整或格式不正确")
	ErrOwnerProtected     = errors.New("店主账号不能被降级或停用")
	ErrSelfProtected      = errors.New("不能删除当前登录账号")
)

type Repository interface {
	FindAccountByUsername(context.Context, string) (domain.Account, error)
	FindAccountBySession(context.Context, string) (domain.Account, error)
	CreateSession(context.Context, int64, string, time.Time) error
	DeleteSession(context.Context, string) error
	TouchLogin(context.Context, int64) error
	UpdateProfile(context.Context, int64, string, string) error
	OperatingData(context.Context, string) (domain.OperatingData, error)
	Products(context.Context, string) ([]domain.Product, error)
	Product(context.Context, string, int64) (domain.Product, error)
	CreateProduct(context.Context, domain.Account, domain.ProductInput) (int64, error)
	UpdateProduct(context.Context, domain.Account, int64, domain.ProductInput) error
	DeleteProduct(context.Context, domain.Account, int64) error
	InventoryOperations(context.Context, string) ([]domain.InventoryOperation, error)
	AdjustStock(context.Context, domain.Account, domain.StockAdjustmentInput) error
	Sales(context.Context, string) ([]domain.Sale, error)
	CreateSale(context.Context, domain.Account, domain.SaleInput) (int64, error)
	ReverseSale(context.Context, domain.Account, int64, string) error
	FinanceEntries(context.Context, string) ([]domain.FinanceEntry, error)
	CreateFinanceEntry(context.Context, domain.Account, domain.FinanceEntryInput) (int64, error)
	ReverseFinanceEntry(context.Context, domain.Account, int64, string) error
	Settings(context.Context, string) ([]domain.Setting, error)
	UpsertSetting(context.Context, domain.Account, domain.SettingInput) error
	AuditLogs(context.Context, string) ([]domain.AuditLog, error)
	Employees(context.Context, string) ([]domain.Employee, error)
	Roles(context.Context, string) ([]domain.Role, error)
	Employee(context.Context, string, int64) (domain.Employee, error)
	CreateEmployee(context.Context, string, string, string, string, string, string) (int64, error)
	UpdateEmployee(context.Context, string, int64, string, string, string, []string, string) error
	DeleteEmployee(context.Context, domain.Account, int64, string) error
	AuditPermissionChange(context.Context, domain.Account, int64, string) error
}

type AdminService struct {
	repo       Repository
	sessionTTL time.Duration
	now        func() time.Time
}

type CreateEmployeeInput struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	Password    string `json:"password"`
}
type UpdateEmployeeInput struct {
	DisplayName string   `json:"displayName"`
	Role        string   `json:"role"`
	Status      string   `json:"status"`
	Password    string   `json:"password"`
	Permissions []string `json:"permissions"`
}

type UpdateProfileInput struct {
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
}

func NewAdminService(repo Repository, sessionTTL time.Duration) *AdminService {
	return &AdminService{repo: repo, sessionTTL: sessionTTL, now: time.Now}
}

func (s *AdminService) Login(ctx context.Context, username, password string) (string, domain.Account, error) {
	account, err := s.repo.FindAccountByUsername(ctx, username)
	if err != nil || account.Status != "active" || !VerifyPassword(account.PasswordHash, password) {
		return "", domain.Account{}, ErrInvalidCredentials
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", domain.Account{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	if err := s.repo.CreateSession(ctx, account.ID, HashToken(token), s.now().Add(s.sessionTTL)); err != nil {
		return "", domain.Account{}, err
	}
	_ = s.repo.TouchLogin(ctx, account.ID)
	return token, account, nil
}

func HashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func (s *AdminService) Authenticate(ctx context.Context, token string) (domain.Account, error) {
	if token == "" {
		return domain.Account{}, ErrUnauthorized
	}
	account, err := s.repo.FindAccountBySession(ctx, HashToken(token))
	if err != nil || account.Status != "active" {
		return domain.Account{}, ErrUnauthorized
	}
	return account, nil
}

func (s *AdminService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repo.DeleteSession(ctx, HashToken(token))
}

func (s *AdminService) UpdateProfile(ctx context.Context, actor domain.Account, input UpdateProfileInput) (domain.Account, error) {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.DisplayName == "" || len([]rune(input.DisplayName)) > 40 || !validAvatar(input.AvatarURL) {
		return domain.Account{}, ErrInvalidInput
	}
	if err := s.repo.UpdateProfile(ctx, actor.ID, input.DisplayName, input.AvatarURL); err != nil {
		return domain.Account{}, err
	}
	actor.DisplayName = input.DisplayName
	actor.AvatarURL = input.AvatarURL
	return actor, nil
}

func validAvatar(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 512_000 {
		return false
	}
	return strings.HasPrefix(value, "data:image/jpeg;base64,") ||
		strings.HasPrefix(value, "data:image/png;base64,") ||
		strings.HasPrefix(value, "data:image/webp;base64,")
}

func (s *AdminService) Products(ctx context.Context, actor domain.Account) ([]domain.Product, error) {
	if !Can(actor, "products.view") {
		return nil, ErrForbidden
	}
	items, err := s.repo.Products(ctx, actor.StoreID)
	if err == nil && !Can(actor, "finance.cost.view") {
		for i := range items {
			items[i].CostPrice = 0
		}
	}
	return items, err
}

func (s *AdminService) Employees(ctx context.Context, actor domain.Account) ([]domain.Employee, []domain.Role, error) {
	if !Can(actor, "system.staff.manage") {
		return nil, nil, ErrForbidden
	}
	employees, err := s.repo.Employees(ctx, actor.StoreID)
	if err != nil {
		return nil, nil, err
	}
	roles, err := s.repo.Roles(ctx, actor.StoreID)
	return employees, roles, err
}

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)

func (s *AdminService) CreateEmployee(ctx context.Context, actor domain.Account, input CreateEmployeeInput) (domain.Employee, error) {
	if !Can(actor, "system.staff.manage") {
		return domain.Employee{}, ErrForbidden
	}
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if !usernamePattern.MatchString(input.Username) || input.DisplayName == "" || len(input.Password) < 8 || !validRole(input.Role) {
		return domain.Employee{}, ErrInvalidInput
	}
	if input.Status == "" {
		input.Status = "active"
	}
	if input.Status != "active" && input.Status != "disabled" {
		return domain.Employee{}, ErrInvalidInput
	}
	if input.Role == "owner" && actor.Role != "owner" {
		return domain.Employee{}, ErrForbidden
	}
	hash, err := HashPassword(input.Password)
	if err != nil {
		return domain.Employee{}, err
	}
	id, err := s.repo.CreateEmployee(ctx, actor.StoreID, input.Username, input.DisplayName, input.Role, input.Status, hash)
	if err != nil {
		return domain.Employee{}, err
	}
	_ = s.repo.AuditPermissionChange(ctx, actor, id, "新增后台成员")
	return s.repo.Employee(ctx, actor.StoreID, id)
}

func (s *AdminService) UpdateEmployee(ctx context.Context, actor domain.Account, id int64, input UpdateEmployeeInput) (domain.Employee, error) {
	if !Can(actor, "system.staff.manage") {
		return domain.Employee{}, ErrForbidden
	}
	target, err := s.repo.Employee(ctx, actor.StoreID, id)
	if err != nil {
		return domain.Employee{}, err
	}
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.DisplayName == "" || !validRole(input.Role) || (input.Status != "active" && input.Status != "disabled") {
		return domain.Employee{}, ErrInvalidInput
	}
	if target.Role == "owner" && (input.Role != "owner" || input.Status != "active") {
		return domain.Employee{}, ErrOwnerProtected
	}
	if id == actor.ID && input.Status != "active" {
		return domain.Employee{}, ErrOwnerProtected
	}
	if (target.Role == "owner" || input.Role == "owner") && actor.Role != "owner" {
		return domain.Employee{}, ErrForbidden
	}
	if !validPermissions(input.Permissions) {
		return domain.Employee{}, ErrInvalidInput
	}
	passwordHash := ""
	if input.Password != "" {
		if len(input.Password) < 8 {
			return domain.Employee{}, ErrInvalidInput
		}
		passwordHash, err = HashPassword(input.Password)
		if err != nil {
			return domain.Employee{}, err
		}
	}
	if err := s.repo.UpdateEmployee(ctx, actor.StoreID, id, input.DisplayName, input.Role, input.Status, input.Permissions, passwordHash); err != nil {
		return domain.Employee{}, err
	}
	_ = s.repo.AuditPermissionChange(ctx, actor, id, "权限变更")
	return s.repo.Employee(ctx, actor.StoreID, id)
}

func (s *AdminService) DeleteEmployee(ctx context.Context, actor domain.Account, id int64, reason string) error {
	if !Can(actor, "system.staff.manage") {
		return ErrForbidden
	}
	if id <= 0 || strings.TrimSpace(reason) == "" {
		return ErrInvalidInput
	}
	target, err := s.repo.Employee(ctx, actor.StoreID, id)
	if err != nil {
		return err
	}
	if target.Role == "owner" {
		return ErrOwnerProtected
	}
	if id == actor.ID {
		return ErrSelfProtected
	}
	return s.repo.DeleteEmployee(ctx, actor, id, strings.TrimSpace(reason))
}

func Can(account domain.Account, permission string) bool {
	return account.Role == "owner" || slices.Contains(account.Permissions, permission)
}

func validRole(role string) bool {
	return slices.Contains([]string{"owner", "admin", "finance", "clerk"}, role)
}

var knownPermissions = []string{
	"dashboard.view", "products.view", "products.edit", "products.export", "inventory.view",
	"inventory.adjust", "sales.view", "sales.edit", "finance.cost.view", "finance.profit.view",
	"finance.entry.edit", "reports.export", "system.staff.manage", "system.settings.manage", "system.audit.view",
}

func validPermissions(permissions []string) bool {
	for _, permission := range permissions {
		if !slices.Contains(knownPermissions, permission) {
			return false
		}
	}
	return true
}
