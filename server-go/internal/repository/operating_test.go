package repository

import "testing"

func TestDecodeMiniOperatingData(t *testing.T) {
	raw := []byte(`{
		"sales":[{"id":"sale-1","productId":"9","productName":"针织衫","businessType":"clothing","specText":"白 / M","quantity":1,"unitPrice":100,"totalAmount":100,"totalCost":40,"grossProfit":60,"paymentMethod":"微信支付","createdAt":"2026-08-19 10:00"}],
		"purchases":[{"id":"purchase-1","productName":"针织衫","businessType":"clothing","quantity":3,"unitCost":40,"totalCost":120,"createdAt":"2026-08-19 09:00"}],
		"manualProfits":[{"id":"entry-1","entryType":"expense","amount":-10,"date":"2026-08-19","note":"运费"}]
	}`)
	data, active, err := decodeMiniOperatingData(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !active || data.Source != "微信小程序" || len(data.Sales) != 1 || len(data.Purchases) != 1 || len(data.Entries) != 1 {
		t.Fatalf("unexpected mini operating data: %#v", data)
	}
	if !data.Sales[0].HasCost || data.Sales[0].Profit != 60 || data.Entries[0].Amount != 10 {
		t.Fatalf("cost/entry adaptation mismatch: %#v", data)
	}
}

func TestDecodeMiniSaleWithoutCostDoesNotInventProfit(t *testing.T) {
	data, _, err := decodeMiniOperatingData([]byte(`{"sales":[{"id":"sale-1","totalAmount":80,"createdAt":"2026-08-19 10:00"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if data.Sales[0].HasCost || data.Sales[0].Profit != 0 || data.Sales[0].CostAmount != 0 {
		t.Fatalf("missing cost was treated as profit: %#v", data.Sales[0])
	}
}
