package repository

import (
	"context"
	"database/sql"
	"fmt"

	"pingping-assistant-admin/internal/domain"
)

func (r *AdminRepository) FinanceEntries(ctx context.Context, storeID string) ([]domain.FinanceEntry, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id,entry_type,category,amount,business_type,note,status,operator_name,DATE_FORMAT(occurred_on,'%Y-%m-%d'),DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') FROM admin_finance_entries WHERE store_id=? ORDER BY occurred_on DESC,id DESC LIMIT 300`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.FinanceEntry, 0)
	for rows.Next() {
		var x domain.FinanceEntry
		if err := rows.Scan(&x.ID, &x.EntryType, &x.Category, &x.Amount, &x.BusinessType, &x.Note, &x.Status, &x.OperatorName, &x.OccurredOn, &x.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (r *AdminRepository) CreateFinanceEntry(ctx context.Context, actor domain.Account, input domain.FinanceEntryInput) (int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO admin_finance_entries(store_id,entry_type,category,amount,business_type,note,operator_id,operator_name,occurred_on) VALUES(?,?,?,?,?,?,?,?,?)`, actor.StoreID, input.EntryType, input.Category, input.Amount, input.BusinessType, input.Note, actor.ID, actor.DisplayName, input.OccurredOn)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	if err = audit(ctx, tx, actor, "新增收支", "收支记录", fmt.Sprint(id), input.Category, input.Note, "normal"); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}
func (r *AdminRepository) ReverseFinanceEntry(ctx context.Context, actor domain.Account, id int64, reason string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE admin_finance_entries SET status='reversed',reason=?,reversed_at=NOW() WHERE store_id=? AND id=? AND status='effective'`, reason, actor.StoreID, id)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		return sql.ErrNoRows
	}
	if err = audit(ctx, tx, actor, "冲正收支", "收支记录", fmt.Sprint(id), "记录已冲正", reason, "danger"); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AdminRepository) Analysis(ctx context.Context, storeID, from, to, businessType string) (domain.Analysis, error) {
	var x domain.Analysis
	filter := ""
	args := []any{storeID, from, to}
	if businessType != "" && businessType != "全部" {
		filter = " AND business_type=?"
		args = append(args, businessType)
	}
	query := `SELECT COALESCE(SUM(amount),0),COALESCE(SUM(cost_amount),0),COUNT(*),COALESCE(SUM(quantity),0) FROM admin_sales WHERE store_id=? AND status='effective' AND DATE(created_at) BETWEEN ? AND ?` + filter
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&x.Revenue, &x.Cost, &x.SalesCount, &x.SoldQuantity); err != nil {
		return x, err
	}
	x.GrossProfit = x.Revenue - x.Cost
	if x.Revenue > 0 {
		x.GrossMargin = x.GrossProfit / x.Revenue * 100
	}
	if x.SalesCount > 0 {
		x.AverageOrder = x.Revenue / float64(x.SalesCount)
	}
	var income, expense float64
	financeFilter := ""
	financeArgs := []any{storeID, from, to}
	if businessType != "" && businessType != "全部" {
		financeFilter = " AND business_type=?"
		financeArgs = append(financeArgs, businessType)
	}
	if err := r.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN entry_type='income' THEN amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN entry_type='expense' THEN amount ELSE 0 END),0) FROM admin_finance_entries WHERE store_id=? AND status='effective' AND occurred_on BETWEEN ? AND ?`+financeFilter, financeArgs...).Scan(&income, &expense); err != nil {
		return x, err
	}
	x.OperatingProfit = x.GrossProfit + income - expense
	rows, err := r.db.QueryContext(ctx, `SELECT DATE_FORMAT(sale_date,'%m-%d'),SUM(amount),SUM(profit)
		FROM (SELECT DATE(created_at) AS sale_date,amount,amount-cost_amount AS profit,business_type
		      FROM admin_sales WHERE store_id=? AND status='effective' AND DATE(created_at) BETWEEN ? AND ?) AS daily
		WHERE 1=1`+filter+` GROUP BY sale_date ORDER BY sale_date`, args...)
	if err != nil {
		return x, err
	}
	for rows.Next() {
		var p domain.AnalysisPoint
		if err = rows.Scan(&p.Date, &p.Revenue, &p.Profit); err != nil {
			rows.Close()
			return x, err
		}
		x.Trend = append(x.Trend, p)
	}
	rows.Close()
	rows, err = r.db.QueryContext(ctx, `SELECT product_name,SUM(quantity),SUM(amount),SUM(amount-cost_amount) FROM admin_sales WHERE store_id=? AND status='effective' AND DATE(created_at) BETWEEN ? AND ?`+filter+` GROUP BY product_id,product_name ORDER BY SUM(amount-cost_amount) DESC LIMIT 10`, args...)
	if err != nil {
		return x, err
	}
	for rows.Next() {
		var p domain.ProductPerformance
		if err = rows.Scan(&p.Name, &p.Quantity, &p.Revenue, &p.Profit); err != nil {
			rows.Close()
			return x, err
		}
		x.Products = append(x.Products, p)
	}
	rows.Close()
	rows, err = r.db.QueryContext(ctx, `SELECT payment_method,SUM(amount) FROM admin_sales WHERE store_id=? AND status='effective' AND DATE(created_at) BETWEEN ? AND ?`+filter+` GROUP BY payment_method ORDER BY SUM(amount) DESC`, args...)
	if err != nil {
		return x, err
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.PaymentPerformance
		if err = rows.Scan(&p.Name, &p.Amount); err != nil {
			return x, err
		}
		x.Payments = append(x.Payments, p)
	}
	return x, rows.Err()
}

func (r *AdminRepository) Settings(ctx context.Context, storeID string) ([]domain.Setting, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id,setting_group,setting_key,label,setting_value,enabled,sort_order FROM admin_settings WHERE store_id=? ORDER BY setting_group,sort_order,id`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Setting, 0)
	for rows.Next() {
		var x domain.Setting
		if err := rows.Scan(&x.ID, &x.Group, &x.Key, &x.Label, &x.Value, &x.Enabled, &x.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (r *AdminRepository) UpsertSetting(ctx context.Context, actor domain.Account, input domain.SettingInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO admin_settings(store_id,setting_group,setting_key,label,setting_value,enabled,sort_order) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),setting_value=VALUES(setting_value),enabled=VALUES(enabled),sort_order=VALUES(sort_order)`, actor.StoreID, input.Group, input.Key, input.Label, input.Value, input.Enabled, input.SortOrder)
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "修改基础设置", "设置", input.Group+"/"+input.Key, input.Label, "", "warning"); err != nil {
		return err
	}
	return tx.Commit()
}
