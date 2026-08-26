package domain

import "errors"

var ErrProductHasHistory = errors.New("商品已有经营历史，不能永久删除")

type ProductDeletionEligibility struct {
	CanDelete bool     `json:"canDelete"`
	Reasons   []string `json:"reasons"`
}

type ProductDeletionBlockedError struct {
	Reasons []string
}

func (e *ProductDeletionBlockedError) Error() string {
	if len(e.Reasons) > 0 {
		return e.Reasons[0]
	}
	return ErrProductHasHistory.Error()
}

func (e *ProductDeletionBlockedError) Unwrap() error {
	return ErrProductHasHistory
}

func ProductDeletionReasons(err error) []string {
	var blocked *ProductDeletionBlockedError
	if errors.As(err, &blocked) {
		return append([]string(nil), blocked.Reasons...)
	}
	return nil
}
