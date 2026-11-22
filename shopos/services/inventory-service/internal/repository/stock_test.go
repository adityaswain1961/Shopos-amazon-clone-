package repository

import (
	"errors"
	"testing"
)

func TestNormalizeMergesAndSorts(t *testing.T) {
	got, err := normalize([]Item{
		{SKU: "B", Quantity: 1},
		{SKU: "A", Quantity: 2},
		{SKU: "B", Quantity: 3},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Sorted by SKU so every transaction locks rows in the same order (no deadlocks),
	// and duplicate SKUs merged into one reservation line.
	want := []Item{{SKU: "A", Quantity: 2}, {SKU: "B", Quantity: 4}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestNormalizeRejectsBadItems(t *testing.T) {
	cases := map[string][]Item{
		"empty":         {},
		"zero qty":      {{SKU: "A", Quantity: 0}},
		"negative qty":  {{SKU: "A", Quantity: -1}},
		"missing sku":   {{SKU: "", Quantity: 1}},
		"absurd amount": {{SKU: "A", Quantity: 10001}},
	}
	for name, items := range cases {
		if _, err := normalize(items); !errors.Is(err, ErrInvalidItems) {
			t.Errorf("%s: expected ErrInvalidItems, got %v", name, err)
		}
	}
}
