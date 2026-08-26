package repository

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

func deletionStateJSON(t *testing.T, state map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestInspectDeletionStateFindsMiniProgramStockAndHistory(t *testing.T) {
	raw := deletionStateJSON(t, map[string]any{
		"products": []any{
			map[string]any{"id": "p-7", "adminProductId": 7, "code": "0007", "specs": []any{
				map[string]any{"id": "s-7", "stock": 2},
			}},
			map[string]any{"id": "p-8", "adminProductId": 8, "code": "0008", "specs": []any{}},
		},
		"sales": []any{
			map[string]any{"productId": "p-7"},
			map[string]any{"productId": "p-8"},
		},
		"purchases":  []any{map[string]any{"adminProductId": 7}},
		"operations": []any{map[string]any{"productId": "p-7"}},
	})

	inspection, err := inspectDeletionState(raw, 7, "0007", "针织衫")
	if err != nil {
		t.Fatal(err)
	}
	if inspection.specStock != 2 || inspection.sales != 1 || inspection.purchases != 1 || inspection.operations != 1 {
		t.Fatalf("unexpected deletion inspection: %#v", inspection)
	}
	if len(inspection.productIDs) != 1 || inspection.productIDs[0] != "p-7" {
		t.Fatalf("unexpected product IDs: %#v", inspection.productIDs)
	}
}

func TestInspectDeletionStateTreatsNegativeSpecStockAsNonZero(t *testing.T) {
	raw := deletionStateJSON(t, map[string]any{
		"products": []any{map[string]any{
			"id": "p-7", "adminProductId": 7, "specs": []any{map[string]any{"stock": -1}},
		}},
		"sales": []any{}, "purchases": []any{}, "operations": []any{},
	})
	inspection, err := inspectDeletionState(raw, 7, "0007", "针织衫")
	if err != nil {
		t.Fatal(err)
	}
	if inspection.specStock != 1 {
		t.Fatalf("negative stock must block deletion, inspection = %#v", inspection)
	}
}

func TestStateDeletionReasonsCoverEveryMiniProgramBlocker(t *testing.T) {
	reasons := stateDeletionReasons(deletionCandidate{Stock: 1}, deletionStateInspection{
		productIndexes: []int{0, 1},
		specStock:      1,
		sales:          1,
		purchases:      1,
		operations:     1,
	})
	if len(reasons) != 6 {
		t.Fatalf("deletion blockers = %#v, want six independent reasons", reasons)
	}
	joined := strings.Join(reasons, "\n")
	for _, value := range []string{"后台库存", "重复商品关联", "规格库存", "销售记录", "采购记录", "库存操作记录"} {
		if !strings.Contains(joined, value) {
			t.Fatalf("missing blocker %q: %q", value, joined)
		}
	}
}

func TestStateWithoutProductPreservesHistoryCodesAndSequence(t *testing.T) {
	raw := deletionStateJSON(t, map[string]any{
		"version": 10, "revisionMarker": "keep", "nextProductNumber": 12,
		"products": []any{
			map[string]any{"id": "p-7", "adminProductId": 7, "code": "0007", "specs": []any{}},
			map[string]any{"id": "p-8", "adminProductId": 8, "code": "0011", "specs": []any{}},
		},
		"sales":     []any{map[string]any{"id": "sale-old", "productId": "p-8"}},
		"purchases": []any{}, "operations": []any{},
	})
	inspection, err := inspectDeletionState(raw, 7, "0007", "误建商品")
	if err != nil {
		t.Fatal(err)
	}
	next, err := inspection.stateWithoutProduct()
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err = json.Unmarshal(next, &state); err != nil {
		t.Fatal(err)
	}
	products := sliceValue(state["products"])
	if len(products) != 1 || textValue(mapValue(products[0])["code"]) != "0011" {
		t.Fatalf("remaining product or code changed: %#v", products)
	}
	if int64Value(state["nextProductNumber"]) != 12 {
		t.Fatalf("nextProductNumber changed: %#v", state["nextProductNumber"])
	}
	if len(sliceValue(state["sales"])) != 1 || textValue(state["revisionMarker"]) != "keep" {
		t.Fatalf("unrelated history/state changed: %#v", state)
	}
}

func TestDeletionAuditSummaryCarriesBothProductIDsAndProfile(t *testing.T) {
	summary := deletionAuditSummary(deletionCandidate{
		ID: 7, Code: "0007", ItemNumber: sql.NullString{String: "HZ-7", Valid: true}, Name: "针织衫",
	}, []string{"p-7"})
	for _, value := range []string{"商品内部ID=p-7", "adminProductId=7", "code=0007", "itemNumber=HZ-7", "商品名称=针织衫", "删除资格="} {
		if !strings.Contains(summary, value) {
			t.Fatalf("audit summary missing %q: %q", value, summary)
		}
	}
}
