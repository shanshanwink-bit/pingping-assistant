package repository

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type deletionStateInspection struct {
	state          map[string]any
	productIDs     []string
	productIndexes []int
	specStock      int
	sales          int
	purchases      int
	operations     int
}

func textValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func int64Value(value any) int64 {
	switch number := value.(type) {
	case float64:
		return int64(number)
	case json.Number:
		result, _ := number.Int64()
		return result
	default:
		result, _ := strconv.ParseInt(textValue(value), 10, 64)
		return result
	}
}

func sliceValue(value any) []any {
	items, _ := value.([]any)
	return items
}

func mapValue(value any) map[string]any {
	item, _ := value.(map[string]any)
	return item
}

func recordMatchesProduct(record map[string]any, productIDs map[string]bool, adminProductID int64, productName string) bool {
	if productIDs[textValue(record["productId"])] {
		return true
	}
	if int64Value(record["adminProductId"]) == adminProductID {
		return true
	}
	return len(productIDs) == 0 && productName != "" && textValue(record["productName"]) == productName
}

func inspectDeletionState(raw []byte, adminProductID int64, code, productName string) (deletionStateInspection, error) {
	state := map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&state); err != nil {
		return deletionStateInspection{}, fmt.Errorf("小程序经营数据无法读取: %w", err)
	}
	products := sliceValue(state["products"])
	indexes := make([]int, 0, 1)
	for index, value := range products {
		product := mapValue(value)
		if int64Value(product["adminProductId"]) == adminProductID {
			indexes = append(indexes, index)
		}
	}
	if len(indexes) == 0 && code != "" {
		for index, value := range products {
			if textValue(mapValue(value)["code"]) == code {
				indexes = append(indexes, index)
			}
		}
	}
	inspection := deletionStateInspection{state: state, productIndexes: indexes}
	productIDs := map[string]bool{}
	for _, index := range indexes {
		product := mapValue(products[index])
		if productID := textValue(product["id"]); productID != "" {
			productIDs[productID] = true
			inspection.productIDs = append(inspection.productIDs, productID)
		}
		for _, specValue := range sliceValue(product["specs"]) {
			stock := int64Value(mapValue(specValue)["stock"])
			if stock != 0 {
				if stock < 0 {
					stock = -stock
				}
				inspection.specStock += int(stock)
			}
		}
	}
	for _, key := range []string{"sales", "purchases", "operations"} {
		count := 0
		for _, value := range sliceValue(state[key]) {
			if recordMatchesProduct(mapValue(value), productIDs, adminProductID, productName) {
				count++
			}
		}
		switch key {
		case "sales":
			inspection.sales = count
		case "purchases":
			inspection.purchases = count
		case "operations":
			inspection.operations = count
		}
	}
	return inspection, nil
}

func (s deletionStateInspection) stateWithoutProduct() ([]byte, error) {
	products := sliceValue(s.state["products"])
	removed := map[int]bool{}
	for _, index := range s.productIndexes {
		removed[index] = true
	}
	remaining := make([]any, 0, len(products)-len(removed))
	for index, product := range products {
		if !removed[index] {
			remaining = append(remaining, product)
		}
	}
	s.state["products"] = remaining
	return json.Marshal(s.state)
}
