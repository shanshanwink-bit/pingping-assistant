package service

import (
	"context"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type employeeDeleteRepo struct {
	Repository
	target  domain.Employee
	deleted int64
	reason  string
}

func (r *employeeDeleteRepo) Employee(context.Context, string, int64) (domain.Employee, error) {
	return r.target, nil
}

func (r *employeeDeleteRepo) DeleteEmployee(_ context.Context, _ domain.Account, id int64, reason string) error {
	r.deleted, r.reason = id, reason
	return nil
}

func TestDeleteEmployeeProtections(t *testing.T) {
	actor := domain.Account{ID: 1, StoreID: "store-1", Role: "owner"}
	repo := &employeeDeleteRepo{target: domain.Employee{ID: 2, Role: "owner"}}
	admin := NewAdminService(repo, time.Hour)
	if err := admin.DeleteEmployee(context.Background(), actor, 2, "重复账号"); err != ErrOwnerProtected {
		t.Fatalf("expected owner protection, got %v", err)
	}
	repo.target = domain.Employee{ID: 1, Role: "admin"}
	if err := admin.DeleteEmployee(context.Background(), actor, 1, "误建账号"); err != ErrSelfProtected {
		t.Fatalf("expected self protection, got %v", err)
	}
	repo.target = domain.Employee{ID: 3, Role: "clerk"}
	if err := admin.DeleteEmployee(context.Background(), actor, 3, "离职移除"); err != nil {
		t.Fatal(err)
	}
	if repo.deleted != 3 || repo.reason != "离职移除" {
		t.Fatalf("unexpected delete call: id=%d reason=%q", repo.deleted, repo.reason)
	}
}
