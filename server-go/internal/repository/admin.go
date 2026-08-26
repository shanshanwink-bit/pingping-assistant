package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type AdminRepository struct{ db *sql.DB }

func NewAdminRepository(db *sql.DB) *AdminRepository { return &AdminRepository{db: db} }

type rowScanner interface{ Scan(...any) error }

func (r *AdminRepository) scanAccount(row rowScanner) (domain.Account, error) {
	var account domain.Account
	var permissions []byte
	err := row.Scan(&account.ID, &account.StoreID, &account.Username, &account.DisplayName, &account.AvatarURL, &account.Role,
		&account.RoleName, &account.Status, &permissions, &account.PasswordHash)
	if err != nil {
		return account, err
	}
	if err := json.Unmarshal(permissions, &account.Permissions); err != nil {
		return account, fmt.Errorf("decode account permissions: %w", err)
	}
	return account, nil
}

func (r *AdminRepository) FindAccountByUsername(ctx context.Context, username string) (domain.Account, error) {
	return r.scanAccount(r.db.QueryRowContext(ctx, `
		SELECT a.id, a.store_id, a.username, a.display_name, COALESCE(a.avatar_url, ''), a.role_key, roles.name, a.status,
		       COALESCE(a.permissions, roles.permissions), a.password_hash
		FROM admin_accounts a JOIN admin_roles roles ON roles.role_key = a.role_key
		WHERE a.username = ?`, strings.ToLower(strings.TrimSpace(username))))
}

func (r *AdminRepository) FindAccountBySession(ctx context.Context, tokenHash string) (domain.Account, error) {
	return r.scanAccount(r.db.QueryRowContext(ctx, `
		SELECT a.id, a.store_id, a.username, a.display_name, COALESCE(a.avatar_url, ''), a.role_key, roles.name, a.status,
		       COALESCE(a.permissions, roles.permissions), a.password_hash
		FROM admin_sessions sessions
		JOIN admin_accounts a ON a.id = sessions.account_id
		JOIN admin_roles roles ON roles.role_key = a.role_key
		WHERE sessions.token_hash = ? AND sessions.expires_at > NOW()`, tokenHash))
}

func (r *AdminRepository) CreateSession(ctx context.Context, accountID int64, tokenHash string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO admin_sessions (account_id, token_hash, expires_at) VALUES (?, ?, ?)`, accountID, tokenHash, expiresAt)
	return err
}

func (r *AdminRepository) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM admin_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (r *AdminRepository) TouchLogin(ctx context.Context, accountID int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE admin_accounts SET last_login_at = NOW() WHERE id = ?`, accountID)
	return err
}

func (r *AdminRepository) UpdateProfile(ctx context.Context, accountID int64, displayName, avatarURL string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE admin_accounts SET display_name = ?, avatar_url = ?
		WHERE id = ? AND status = 'active'`, displayName, avatarURL, accountID)
	if err != nil {
		return err
	}
	matched, _ := result.RowsAffected()
	if matched == 0 {
		var exists int
		if err := r.db.QueryRowContext(ctx, `SELECT 1 FROM admin_accounts WHERE id = ? AND status = 'active'`, accountID).Scan(&exists); err != nil {
			return err
		}
	}
	return nil
}

func (r *AdminRepository) Dashboard(ctx context.Context, storeID string) (domain.Dashboard, error) {
	result := domain.Dashboard{Trend: []float64{}, Tasks: []domain.TaskItem{}, Risks: []domain.RiskItem{}}
	err := r.db.QueryRowContext(ctx, `
		SELECT DATE_FORMAT(NOW(), '%H:%i'),
		       COALESCE(SUM(amount), 0),
		       COALESCE(SUM(amount - cost_amount), 0),
		       COALESCE(SUM(quantity), 0),
		       COUNT(*)
		FROM admin_sales
		WHERE store_id = ? AND status = 'effective'
		  AND created_at >= CURRENT_DATE()
		  AND created_at < CURRENT_DATE() + INTERVAL 1 DAY`, storeID).Scan(
		&result.UpdatedAt, &result.SalesAmount, &result.Profit,
		&result.SoldQuantity, &result.SalesCount)
	if err != nil {
		return result, err
	}

	err = r.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(stock * cost_price), 0), COALESCE(SUM(stock), 0)
		FROM admin_products WHERE store_id = ?`, storeID).Scan(
		&result.InventoryCost, &result.InventoryQuantity)
	if err != nil {
		return result, err
	}

	rows, err := r.db.QueryContext(ctx, `
		WITH RECURSIVE days AS (
		  SELECT CURRENT_DATE() - INTERVAL 6 DAY AS day
		  UNION ALL
		  SELECT day + INTERVAL 1 DAY FROM days WHERE day < CURRENT_DATE()
		)
		SELECT CAST(ROUND(COALESCE(SUM(s.amount), 0), 0) AS SIGNED)
		FROM days
		LEFT JOIN admin_sales s ON s.store_id = ? AND s.status = 'effective'
		  AND s.created_at >= days.day AND s.created_at < days.day + INTERVAL 1 DAY
		GROUP BY days.day ORDER BY days.day`, storeID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var amount float64
		if err := rows.Scan(&amount); err != nil {
			return result, err
		}
		result.Trend = append(result.Trend, amount)
	}
	return result, rows.Err()
}

func (r *AdminRepository) Products(ctx context.Context, storeID string) ([]domain.Product, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, code, item_number, item_number_managed, business_type, category, spec_count, stock, cost_price,
		       low_stock_threshold, location, price, status,
		       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i'), image_url
		FROM admin_products WHERE store_id = ? ORDER BY sort_order, id`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Product, 0)
	for rows.Next() {
		item, err := scanProduct(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AdminRepository) Employees(ctx context.Context, storeID string) ([]domain.Employee, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT a.id, a.username, a.display_name, a.role_key, roles.name, a.status,
		       COALESCE(a.permissions, roles.permissions), a.last_login_at, a.created_at
		FROM admin_accounts a JOIN admin_roles roles ON roles.role_key = a.role_key
		WHERE a.store_id = ? AND a.status <> 'deleted'
		ORDER BY FIELD(a.role_key, 'owner','admin','finance','clerk'), a.created_at`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Employee, 0)
	for rows.Next() {
		var item domain.Employee
		var permissions []byte
		var lastLogin sql.NullTime
		if err := rows.Scan(&item.ID, &item.Username, &item.DisplayName, &item.Role, &item.RoleName,
			&item.Status, &permissions, &lastLogin, &item.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(permissions, &item.Permissions); err != nil {
			return nil, err
		}
		if lastLogin.Valid {
			item.LastLoginAt = &lastLogin.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AdminRepository) Roles(ctx context.Context, storeID string) ([]domain.Role, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT roles.role_key, roles.name, roles.description, roles.permissions, COUNT(accounts.id)
		FROM admin_roles roles LEFT JOIN admin_accounts accounts
		  ON accounts.role_key = roles.role_key AND accounts.store_id = ?
		GROUP BY roles.role_key, roles.name, roles.description, roles.permissions, roles.sort_order
		ORDER BY roles.sort_order`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Role, 0)
	for rows.Next() {
		var item domain.Role
		var permissions []byte
		if err := rows.Scan(&item.Key, &item.Name, &item.Description, &permissions, &item.MemberCount); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(permissions, &item.Permissions); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AdminRepository) Employee(ctx context.Context, storeID string, id int64) (domain.Employee, error) {
	var item domain.Employee
	var permissions []byte
	var lastLogin sql.NullTime
	err := r.db.QueryRowContext(ctx, `
		SELECT a.id, a.username, a.display_name, a.role_key, roles.name, a.status,
		       COALESCE(a.permissions, roles.permissions), a.last_login_at, a.created_at
		FROM admin_accounts a JOIN admin_roles roles ON roles.role_key = a.role_key
		WHERE a.store_id = ? AND a.id = ? AND a.status <> 'deleted'`, storeID, id).Scan(&item.ID, &item.Username, &item.DisplayName,
		&item.Role, &item.RoleName, &item.Status, &permissions, &lastLogin, &item.CreatedAt)
	if err != nil {
		return item, err
	}
	if err := json.Unmarshal(permissions, &item.Permissions); err != nil {
		return item, err
	}
	if lastLogin.Valid {
		item.LastLoginAt = &lastLogin.Time
	}
	return item, nil
}

func (r *AdminRepository) CreateEmployee(ctx context.Context, storeID, username, displayName, role, status, passwordHash string) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO admin_accounts (store_id, username, display_name, role_key, status, password_hash)
		VALUES (?, ?, ?, ?, ?, ?)`, storeID, username, displayName, role, status, passwordHash)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (r *AdminRepository) UpdateEmployee(ctx context.Context, storeID string, id int64, displayName, role, status string, permissions []string, resetPasswordHash string) error {
	permissionsJSON, err := json.Marshal(permissions)
	if err != nil {
		return err
	}
	query := `UPDATE admin_accounts SET display_name=?, role_key=?, status=?, permissions=? WHERE store_id=? AND id=?`
	args := []any{displayName, role, status, permissionsJSON, storeID, id}
	if resetPasswordHash != "" {
		query = `UPDATE admin_accounts SET display_name=?, role_key=?, status=?, permissions=?, password_hash=? WHERE store_id=? AND id=?`
		args = []any{displayName, role, status, permissionsJSON, resetPasswordHash, storeID, id}
	}
	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *AdminRepository) DeleteEmployee(ctx context.Context, actor domain.Account, id int64, reason string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var displayName string
	if err = tx.QueryRowContext(ctx, `SELECT display_name FROM admin_accounts WHERE store_id=? AND id=? AND status<>'deleted' FOR UPDATE`, actor.StoreID, id).Scan(&displayName); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE admin_accounts
		SET username=CONCAT('deleted_',id,'_',UNIX_TIMESTAMP()), display_name=CONCAT(LEFT(display_name,35),'（已删除）'),
		    status='deleted', permissions=JSON_ARRAY()
		WHERE store_id=? AND id=?`, actor.StoreID, id)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		return sql.ErrNoRows
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM admin_sessions WHERE account_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO admin_risk_logs
		(display_time,action_name,operator_name,status_name,tone,sort_order)
		VALUES (DATE_FORMAT(NOW(),'%H:%i'),'删除后台成员',?,'高危','danger',0)`, fmt.Sprintf("%s (%s)", actor.DisplayName, actor.RoleName)); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "删除后台成员", "员工账号", fmt.Sprint(id), displayName, reason, "danger"); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AdminRepository) AuditPermissionChange(ctx context.Context, actor domain.Account, targetID int64, action string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO admin_risk_logs (display_time, action_name, operator_name, status_name, tone, sort_order)
		VALUES (DATE_FORMAT(NOW(), '%H:%i'), ?, ?, '高危', 'danger', 0)`,
		action, fmt.Sprintf("%s (%s)", actor.DisplayName, actor.RoleName))
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, action, "员工账号", fmt.Sprint(targetID), "角色、状态或权限发生变化", "", "danger"); err != nil {
		return err
	}
	return tx.Commit()
}

func IsNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }
