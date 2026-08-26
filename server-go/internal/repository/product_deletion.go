package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"pingping-assistant-admin/internal/domain"
)

type deletionQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type deletionCandidate struct {
	ID         int64
	Code       string
	ItemNumber sql.NullString
	Name       string
	Stock      int
}

type deletionSnapshot struct {
	candidate  deletionCandidate
	revision   int64
	inspection deletionStateInspection
	reasons    []string
}

func countRows(ctx context.Context, query deletionQuerier, statement string, args ...any) (int, error) {
	var count int
	if err := query.QueryRowContext(ctx, statement, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func businessAuditCount(ctx context.Context, query deletionQuerier, storeID string, adminProductID int64, productIDs []string) (int, error) {
	conditions := []string{"CAST(JSON_UNQUOTE(JSON_EXTRACT(details,'$.adminProductId')) AS UNSIGNED)=?"}
	args := []any{storeID, adminProductID}
	if len(productIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(productIDs)), ",")
		conditions = append(conditions, "JSON_UNQUOTE(JSON_EXTRACT(details,'$.productId')) IN ("+placeholders+")")
		for _, productID := range productIDs {
			args = append(args, productID)
		}
	}
	statement := `SELECT COUNT(*) FROM audit_logs
		WHERE store_id=?
		AND (action IN ('miniapp.sale.create','miniapp.purchase.create')
			OR action LIKE 'miniapp.inventory.%' OR action LIKE 'miniapp.stock.%')
		AND (` + strings.Join(conditions, " OR ") + `)`
	return countRows(ctx, query, statement, args...)
}

func stateDeletionReasons(candidate deletionCandidate, inspection deletionStateInspection) []string {
	reasons := make([]string, 0)
	if candidate.Stock != 0 {
		reasons = append(reasons, "该商品后台库存不为零，不能永久删除，请先核对库存或停用商品。")
	}
	if len(inspection.productIndexes) > 1 {
		reasons = append(reasons, "小程序存在重复商品关联，无法安全永久删除，请停用商品。")
	}
	if inspection.specStock != 0 {
		reasons = append(reasons, "该商品小程序规格库存不为零，不能永久删除，请先核对库存或停用商品。")
	}
	if inspection.sales > 0 {
		reasons = append(reasons, "该商品已有销售记录，不能永久删除，请停用商品。")
	}
	if inspection.purchases > 0 {
		reasons = append(reasons, "该商品已有采购记录，不能永久删除，请停用商品。")
	}
	if inspection.operations > 0 {
		reasons = append(reasons, "该商品已有库存操作记录，不能永久删除，请停用商品。")
	}
	return reasons
}

func databaseDeletionReasons(ctx context.Context, query deletionQuerier, storeID string, productID int64, productIDs []string) ([]string, error) {
	reasons := make([]string, 0)
	adminSales, err := countRows(ctx, query, "SELECT COUNT(*) FROM admin_sales WHERE store_id=? AND product_id=?", storeID, productID)
	if err != nil {
		return nil, err
	}
	if adminSales > 0 {
		reasons = append(reasons, "该商品已有后台销售记录，不能永久删除，请停用商品。")
	}
	adminOperations, err := countRows(ctx, query, "SELECT COUNT(*) FROM admin_inventory_operations WHERE store_id=? AND product_id=?", storeID, productID)
	if err != nil {
		return nil, err
	}
	if adminOperations > 0 {
		reasons = append(reasons, "该商品已有后台库存操作，不能永久删除，请停用商品。")
	}
	auditCount, err := businessAuditCount(ctx, query, storeID, productID, productIDs)
	if err != nil {
		return nil, err
	}
	if auditCount > 0 {
		reasons = append(reasons, "该商品已有销售、采购或库存业务审计，不能永久删除，请停用商品。")
	}
	return reasons, nil
}

func loadDeletionSnapshot(ctx context.Context, query deletionQuerier, storeID string, productID int64, lock bool) (deletionSnapshot, error) {
	lockClause := ""
	if lock {
		lockClause = " FOR UPDATE"
	}
	var rawState []byte
	var snapshot deletionSnapshot
	if err := query.QueryRowContext(ctx,
		"SELECT state,revision FROM store_states WHERE store_id=?"+lockClause,
		storeID,
	).Scan(&rawState, &snapshot.revision); err != nil {
		return deletionSnapshot{}, err
	}
	if err := query.QueryRowContext(ctx,
		"SELECT id,code,item_number,name,stock FROM admin_products WHERE store_id=? AND id=?"+lockClause,
		storeID, productID,
	).Scan(
		&snapshot.candidate.ID,
		&snapshot.candidate.Code,
		&snapshot.candidate.ItemNumber,
		&snapshot.candidate.Name,
		&snapshot.candidate.Stock,
	); err != nil {
		return deletionSnapshot{}, err
	}
	inspection, err := inspectDeletionState(
		rawState,
		snapshot.candidate.ID,
		snapshot.candidate.Code,
		snapshot.candidate.Name,
	)
	if err != nil {
		return deletionSnapshot{}, err
	}
	snapshot.inspection = inspection
	snapshot.reasons = stateDeletionReasons(snapshot.candidate, inspection)
	databaseReasons, err := databaseDeletionReasons(ctx, query, storeID, productID, inspection.productIDs)
	if err != nil {
		return deletionSnapshot{}, err
	}
	snapshot.reasons = append(snapshot.reasons, databaseReasons...)
	return snapshot, nil
}

func (r *AdminRepository) ProductDeletionEligibility(ctx context.Context, storeID string, productID int64) (domain.ProductDeletionEligibility, error) {
	snapshot, err := loadDeletionSnapshot(ctx, r.db, storeID, productID, false)
	if err != nil {
		return domain.ProductDeletionEligibility{}, err
	}
	return domain.ProductDeletionEligibility{
		CanDelete: len(snapshot.reasons) == 0,
		Reasons:   append([]string{}, snapshot.reasons...),
	}, nil
}

func deletionAuditSummary(candidate deletionCandidate, productIDs []string) string {
	itemNumber := candidate.ItemNumber.String
	if itemNumber == "" {
		itemNumber = "未填写"
	}
	productID := strings.Join(productIDs, ",")
	if productID == "" {
		productID = "未同步"
	}
	return fmt.Sprintf(
		"商品内部ID=%s；adminProductId=%d；code=%s；itemNumber=%s；商品名称=%s；删除资格=聚合库存0、规格库存0、无销售采购库存及业务审计历史",
		productID,
		candidate.ID,
		candidate.Code,
		itemNumber,
		candidate.Name,
	)
}

func (r *AdminRepository) DeleteProduct(ctx context.Context, actor domain.Account, input domain.ProductDeletionInput) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	snapshot, err := loadDeletionSnapshot(ctx, tx, actor.StoreID, input.ProductID, true)
	if err != nil {
		return err
	}
	if len(snapshot.reasons) > 0 {
		return &domain.ProductDeletionBlockedError{Reasons: snapshot.reasons}
	}
	nextState, err := snapshot.inspection.stateWithoutProduct()
	if err != nil {
		return err
	}
	stateResult, err := tx.ExecContext(ctx, `UPDATE store_states
		SET state=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
		WHERE store_id=? AND revision=?`, nextState, actor.StoreID, snapshot.revision)
	if err != nil {
		return err
	}
	stateChanged, _ := stateResult.RowsAffected()
	if stateChanged != 1 {
		return fmt.Errorf("store_states revision changed during product deletion")
	}
	productResult, err := tx.ExecContext(ctx, "DELETE FROM admin_products WHERE store_id=? AND id=?", actor.StoreID, input.ProductID)
	if err != nil {
		return err
	}
	productChanged, _ := productResult.RowsAffected()
	if productChanged != 1 {
		return sql.ErrNoRows
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO admin_audit_logs
		(store_id,operator_id,operator_name,operator_role,action,object_type,object_id,summary,reason,request_id,risk_level)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		actor.StoreID,
		actor.ID,
		actor.DisplayName,
		actor.RoleName,
		"永久删除无历史商品",
		"商品",
		fmt.Sprint(input.ProductID),
		deletionAuditSummary(snapshot.candidate, snapshot.inspection.productIDs),
		"仅允许零库存、无经营历史商品",
		input.RequestID,
		"danger",
	)
	if err != nil {
		return err
	}
	return tx.Commit()
}
