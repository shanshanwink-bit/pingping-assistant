package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"pingping-assistant-admin/internal/domain"
)

func scanProduct(row rowScanner) (domain.Product, error) {
	var item domain.Product
	var itemNumber sql.NullString
	err := row.Scan(&item.ID, &item.Name, &item.Code, &itemNumber, &item.ItemNumberManaged, &item.BusinessType, &item.Category,
		&item.SpecCount, &item.Stock, &item.CostPrice, &item.LowStockThreshold, &item.Location,
		&item.Price, &item.Status, &item.UpdatedAt, &item.Image)
	item.ItemNumber = itemNumber.String
	return item, err
}

func nullableItemNumber(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (r *AdminRepository) Product(ctx context.Context, storeID string, id int64) (domain.Product, error) {
	return scanProduct(r.db.QueryRowContext(ctx, `SELECT id,name,code,item_number,item_number_managed,business_type,category,spec_count,stock,cost_price,
		low_stock_threshold,location,price,status,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i'),image_url
		FROM admin_products WHERE store_id=? AND id=?`, storeID, id))
}

func audit(ctx context.Context, exec interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, actor domain.Account, action, objectType, objectID, summary, reason, risk string) error {
	_, err := exec.ExecContext(ctx, `INSERT INTO admin_audit_logs
		(store_id,operator_id,operator_name,operator_role,action,object_type,object_id,summary,reason,risk_level)
		VALUES (?,?,?,?,?,?,?,?,?,?)`, actor.StoreID, actor.ID, actor.DisplayName, actor.RoleName, action, objectType, objectID, summary, reason, risk)
	return err
}

func (r *AdminRepository) CreateProduct(ctx context.Context, actor domain.Account, input domain.ProductInput) (int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT IGNORE INTO admin_product_code_sequences(store_id,next_number) VALUES(?,1)`, actor.StoreID); err != nil {
		return 0, err
	}
	var nextNumber uint64
	if err = tx.QueryRowContext(ctx, `SELECT next_number FROM admin_product_code_sequences WHERE store_id=? FOR UPDATE`, actor.StoreID).Scan(&nextNumber); err != nil {
		return 0, err
	}
	for {
		input.Code = fmt.Sprintf("%04d", nextNumber)
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM admin_products WHERE store_id=? AND code=?)`, actor.StoreID, input.Code).Scan(&exists); err != nil {
			return 0, err
		}
		if !exists {
			break
		}
		nextNumber++
	}
	if _, err = tx.ExecContext(ctx, `UPDATE admin_product_code_sequences SET next_number=? WHERE store_id=?`, nextNumber+1, actor.StoreID); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO admin_products
		(store_id,name,code,item_number,item_number_managed,business_type,category,spec_count,stock,cost_price,low_stock_threshold,location,price,status,image_url)
		VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`, actor.StoreID, input.Name, input.Code, nullableItemNumber(input.ItemNumber), input.ItemNumberManaged, input.BusinessType, input.Category, input.SpecCount,
		input.CostPrice, input.LowStockThreshold, input.Location, input.Price, input.Status, input.Image)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err = audit(ctx, tx, actor, "新建商品", "商品", fmt.Sprint(id), input.Name, "", "normal"); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

func (r *AdminRepository) UpdateProduct(ctx context.Context, actor domain.Account, id int64, input domain.ProductInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE admin_products SET name=?,item_number=?,item_number_managed=?,business_type=?,category=?,spec_count=?,
		cost_price=?,low_stock_threshold=?,location=?,price=?,status=?,image_url=? WHERE store_id=? AND id=?`,
		input.Name, nullableItemNumber(input.ItemNumber), input.ItemNumberManaged, input.BusinessType, input.Category, input.SpecCount, input.CostPrice, input.LowStockThreshold, input.Location,
		input.Price, input.Status, input.Image, actor.StoreID, id)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		return sql.ErrNoRows
	}
	action, risk := input.AuditAction, input.AuditRisk
	if action == "" {
		action = "编辑商品"
	}
	if risk == "" {
		risk = "normal"
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO admin_audit_logs
		(store_id,operator_id,operator_name,operator_role,action,object_type,object_id,summary,reason,risk_level,request_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`, actor.StoreID, actor.ID, actor.DisplayName, actor.RoleName, action, "商品", fmt.Sprint(id), input.AuditSummary, "", risk, input.RequestID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AdminRepository) InventoryOperations(ctx context.Context, storeID string) ([]domain.InventoryOperation, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT o.id,o.product_id,p.name,o.operation_type,o.before_stock,o.quantity_change,o.after_stock,
		o.reason,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') FROM admin_inventory_operations o
		JOIN admin_products p ON p.id=o.product_id WHERE o.store_id=? ORDER BY o.id DESC LIMIT 200`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.InventoryOperation, 0)
	for rows.Next() {
		var x domain.InventoryOperation
		if err := rows.Scan(&x.ID, &x.ProductID, &x.ProductName, &x.OperationType, &x.BeforeStock, &x.QuantityChange, &x.AfterStock, &x.Reason, &x.OperatorName, &x.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}

func (r *AdminRepository) AdjustStock(ctx context.Context, actor domain.Account, input domain.StockAdjustmentInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var before int
	var name, status string
	if err = tx.QueryRowContext(ctx, `SELECT stock,name,status FROM admin_products WHERE store_id=? AND id=? FOR UPDATE`, actor.StoreID, input.ProductID).Scan(&before, &name, &status); err != nil {
		return err
	}
	if !domain.IsProductActiveStatus(status) {
		return domain.ErrProductInactive
	}
	after := before + input.QuantityChange
	if after < 0 {
		return fmt.Errorf("%w: 库存不足，修正后不能小于 0", domain.ErrBusinessRule)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE admin_products SET stock=? WHERE id=?`, after, input.ProductID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO admin_inventory_operations(store_id,product_id,operation_type,before_stock,quantity_change,after_stock,reason,operator_id,operator_name)
		VALUES(?,?,'adjust',?,?,?,?,?,?)`, actor.StoreID, input.ProductID, before, input.QuantityChange, after, input.Reason, actor.ID, actor.DisplayName); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "库存修正", "商品", fmt.Sprint(input.ProductID), fmt.Sprintf("%s：%d → %d", name, before, after), input.Reason, "warning"); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AdminRepository) Sales(ctx context.Context, storeID string) ([]domain.Sale, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id,order_no,product_id,product_name,business_type,quantity,unit_price,amount,cost_amount,
		amount-cost_amount,payment_method,status,operator_name,reason,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') FROM admin_sales WHERE store_id=? ORDER BY id DESC LIMIT 300`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Sale, 0)
	for rows.Next() {
		var x domain.Sale
		if err := rows.Scan(&x.ID, &x.OrderNo, &x.ProductID, &x.ProductName, &x.BusinessType, &x.Quantity, &x.UnitPrice, &x.Amount, &x.CostAmount, &x.Profit, &x.PaymentMethod, &x.Status, &x.OperatorName, &x.Reason, &x.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}

func (r *AdminRepository) CreateSale(ctx context.Context, actor domain.Account, input domain.SaleInput) (int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var product domain.Product
	err = tx.QueryRowContext(ctx, `SELECT id,name,code,business_type,category,spec_count,stock,cost_price,low_stock_threshold,location,price,status,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i'),image_url FROM admin_products WHERE store_id=? AND id=? FOR UPDATE`, actor.StoreID, input.ProductID).Scan(&product.ID, &product.Name, &product.Code, &product.BusinessType, &product.Category, &product.SpecCount, &product.Stock, &product.CostPrice, &product.LowStockThreshold, &product.Location, &product.Price, &product.Status, &product.UpdatedAt, &product.Image)
	if err != nil {
		return 0, err
	}
	if !domain.IsProductActiveStatus(product.Status) {
		return 0, domain.ErrProductInactive
	}
	if product.Stock < input.Quantity {
		return 0, fmt.Errorf("%w: 商品库存不足", domain.ErrBusinessRule)
	}
	after := product.Stock - input.Quantity
	amount := float64(input.Quantity) * input.UnitPrice
	cost := float64(input.Quantity) * product.CostPrice
	orderNo := fmt.Sprintf("XS%s%04d", time.Now().Format("20060102150405"), time.Now().UnixNano()%10000)
	result, err := tx.ExecContext(ctx, `INSERT INTO admin_sales(store_id,order_no,product_id,product_name,business_type,quantity,unit_price,amount,cost_amount,payment_method,operator_id,operator_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, actor.StoreID, orderNo, product.ID, product.Name, product.BusinessType, input.Quantity, input.UnitPrice, amount, cost, input.PaymentMethod, actor.ID, actor.DisplayName)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	if _, err = tx.ExecContext(ctx, `UPDATE admin_products SET stock=? WHERE id=?`, after, product.ID); err != nil {
		return 0, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO admin_inventory_operations(store_id,product_id,operation_type,before_stock,quantity_change,after_stock,reason,reference_type,reference_id,operator_id,operator_name) VALUES(?,?,'sale',?,?,?,'销售出库','sale',?,?,?)`, actor.StoreID, product.ID, product.Stock, -input.Quantity, after, id, actor.ID, actor.DisplayName); err != nil {
		return 0, err
	}
	if err = audit(ctx, tx, actor, "新增销售", "销售单", fmt.Sprint(id), orderNo, "", "normal"); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

func (r *AdminRepository) ReverseSale(ctx context.Context, actor domain.Account, id int64, reason string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var sale domain.Sale
	if err = tx.QueryRowContext(ctx, `SELECT product_id,product_name,quantity,status,order_no FROM admin_sales WHERE store_id=? AND id=? FOR UPDATE`, actor.StoreID, id).Scan(&sale.ProductID, &sale.ProductName, &sale.Quantity, &sale.Status, &sale.OrderNo); err != nil {
		return err
	}
	if sale.Status != "effective" {
		return fmt.Errorf("%w: 该销售记录已作废", domain.ErrBusinessRule)
	}
	var before int
	if err = tx.QueryRowContext(ctx, `SELECT stock FROM admin_products WHERE id=? FOR UPDATE`, sale.ProductID).Scan(&before); err != nil {
		return err
	}
	after := before + sale.Quantity
	if _, err = tx.ExecContext(ctx, `UPDATE admin_sales SET status='reversed',reason=?,reversed_at=NOW() WHERE id=?`, reason, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE admin_products SET stock=? WHERE id=?`, after, sale.ProductID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO admin_inventory_operations(store_id,product_id,operation_type,before_stock,quantity_change,after_stock,reason,reference_type,reference_id,operator_id,operator_name) VALUES(?,?,'reversal',?,?,?,?, 'sale',?,?,?)`, actor.StoreID, sale.ProductID, before, sale.Quantity, after, reason, id, actor.ID, actor.DisplayName); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "作废销售", "销售单", fmt.Sprint(id), sale.OrderNo, reason, "danger"); err != nil {
		return err
	}
	return tx.Commit()
}
