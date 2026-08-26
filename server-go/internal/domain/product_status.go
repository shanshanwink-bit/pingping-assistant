package domain

import "strings"

const (
	ProductStatusSelling    = "销售中"
	ProductStatusOutOfStock = "缺货"
	ProductStatusInactive   = "已停用"
)

func NormalizeProductStatus(value string) string {
	switch strings.TrimSpace(value) {
	case ProductStatusInactive:
		return ProductStatusInactive
	case ProductStatusOutOfStock:
		return ProductStatusOutOfStock
	default:
		return ProductStatusSelling
	}
}

func IsProductActiveStatus(value string) bool {
	return NormalizeProductStatus(value) != ProductStatusInactive
}

func IsEditableProductStatus(value string) bool {
	status := strings.TrimSpace(value)
	return status == ProductStatusSelling || status == ProductStatusOutOfStock || status == ProductStatusInactive
}
