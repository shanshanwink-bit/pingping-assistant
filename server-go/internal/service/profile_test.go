package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"pingping-assistant-admin/internal/domain"
)

type profileRepo struct {
	Repository
	id          int64
	displayName string
	avatarURL   string
}

func (r *profileRepo) UpdateProfile(_ context.Context, id int64, displayName, avatarURL string) error {
	r.id, r.displayName, r.avatarURL = id, displayName, avatarURL
	return nil
}

func TestUpdateProfile(t *testing.T) {
	repo := &profileRepo{}
	admin := NewAdminService(repo, time.Hour)
	actor := domain.Account{ID: 7, DisplayName: "旧名字", Role: "owner"}
	avatar := "data:image/png;base64,aGVsbG8="

	updated, err := admin.UpdateProfile(context.Background(), actor, UpdateProfileInput{
		DisplayName: "  新名字  ", AvatarURL: avatar,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.id != 7 || repo.displayName != "新名字" || repo.avatarURL != avatar {
		t.Fatalf("unexpected repository call: %#v", repo)
	}
	if updated.DisplayName != "新名字" || updated.AvatarURL != avatar {
		t.Fatalf("unexpected account: %#v", updated)
	}
}

func TestUpdateProfileRejectsInvalidAvatarAndName(t *testing.T) {
	admin := NewAdminService(&profileRepo{}, time.Hour)
	actor := domain.Account{ID: 7}
	cases := []UpdateProfileInput{
		{DisplayName: ""},
		{DisplayName: strings.Repeat("名", 41)},
		{DisplayName: "名字", AvatarURL: "https://example.com/avatar.png"},
	}
	for _, input := range cases {
		if _, err := admin.UpdateProfile(context.Background(), actor, input); err != ErrInvalidInput {
			t.Fatalf("input %#v: expected invalid input, got %v", input, err)
		}
	}
}
