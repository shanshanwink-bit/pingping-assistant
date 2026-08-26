package repository

import (
	"database/sql"
	"testing"
)

type productScanRow struct {
	itemNumber any
}

func (r productScanRow) Scan(dest ...any) error {
	*(dest[0].(*int64)) = 8
	*(dest[1].(*string)) = "旧商品"
	*(dest[2].(*string)) = "0008"
	if err := dest[3].(*sql.NullString).Scan(r.itemNumber); err != nil {
		return err
	}
	*(dest[4].(*bool)) = false
	*(dest[5].(*string)) = "服装"
	return nil
}

func TestScanProductAcceptsNullItemNumber(t *testing.T) {
	item, err := scanProduct(productScanRow{itemNumber: nil})
	if err != nil {
		t.Fatal(err)
	}
	if item.Code != "0008" || item.ItemNumber != "" {
		t.Fatalf("unexpected legacy product: %#v", item)
	}
}

func TestNullableItemNumberWritesEmptyAsNull(t *testing.T) {
	if value := nullableItemNumber(""); value != nil {
		t.Fatalf("empty itemNumber should become SQL NULL, got %#v", value)
	}
	if value := nullableItemNumber("A-136"); value != "A-136" {
		t.Fatalf("non-empty itemNumber changed: %#v", value)
	}
}
