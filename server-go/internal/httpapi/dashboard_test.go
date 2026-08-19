package httpapi

import (
	"testing"

	"pingping-assistant-admin/internal/domain"
)

func TestDashboardPayloadOmitsCostWithoutPermission(t *testing.T) {
	payload := dashboardPayload(domain.Dashboard{SalesAmount: 100, SoldCost: 40, InventoryCost: 80})
	if _, exists := payload["soldCost"]; exists {
		t.Fatal("soldCost must not be returned without permission")
	}
	if _, exists := payload["inventoryCost"]; exists {
		t.Fatal("inventoryCost must not be returned without permission")
	}
}

func TestDashboardPayloadOmitsProfitWithoutPermission(t *testing.T) {
	payload := dashboardPayload(domain.Dashboard{Profit: 60, Trend: []float64{60}})
	if _, exists := payload["profit"]; exists {
		t.Fatal("profit must not be returned without permission")
	}
	if _, exists := payload["trend"]; exists {
		t.Fatal("profit trend must not be returned without permission")
	}
}
