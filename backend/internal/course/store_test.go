package course

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// testStore connects to the dev MySQL (docker compose, ocm-mysql-dev) and skips
// the test when unreachable, so CI environments without a database stay green.
// Override the DSN with OCM_TEST_DSN when running against another instance.
func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("OCM_TEST_DSN")
	if dsn == "" {
		dsn = "ocm:ocm@tcp(127.0.0.1:3306)/ocm?parseTime=true"
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Skipf("打开数据库失败，跳过集成测试：%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("数据库不可达，跳过集成测试：%v", err)
	}
	s := NewStore(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return s
}

// TestCatalogNullCodeRoundTrip 空 code 课程以 NULL 落库后，读侧经 COALESCE
// 兜底应返回空串而不是 500（回归：sql: converting NULL to string is unsupported）。
func TestCatalogNullCodeRoundTrip(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	name := "测试无代码课程"

	// 清理同名历史数据（name 唯一，重跑安全）。
	if rows, err := s.ListCatalog(ctx); err == nil {
		for _, c := range rows {
			if c.Name == name {
				_ = s.DeleteCatalog(ctx, c.ID)
			}
		}
	}

	c, err := s.CreateCatalog(ctx, CatalogInput{Name: name})
	if err != nil {
		t.Fatalf("CreateCatalog: %v", err)
	}
	defer func() { _ = s.DeleteCatalog(ctx, c.ID) }()

	if c.Code != "" {
		t.Errorf("CreateCatalog 返回 code = %q，期望空串", c.Code)
	}
	got, err := s.GetCatalog(ctx, c.ID)
	if err != nil {
		t.Fatalf("GetCatalog: %v", err)
	}
	if got.Code != "" {
		t.Errorf("GetCatalog code = %q，期望空串（NULL 读侧兜底）", got.Code)
	}
	list, err := s.ListCatalog(ctx)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	found := false
	for _, it := range list {
		if it.ID == c.ID {
			found = true
			if it.Code != "" {
				t.Errorf("ListCatalog code = %q，期望空串", it.Code)
			}
		}
	}
	if !found {
		t.Errorf("ListCatalog 未包含新插入的空 code 课程")
	}
}

// TestOfferingSessionNullCodeRead NULL code 课程被建开课/课次后，GetOffering /
// GetSession / ListSessions 读侧经 COALESCE 兜底应返回空串而不是扫描报错
// （回归：converting NULL to string is unsupported，开课/课次查询是课程库之外
// 仍裸扫 c.code 的高危路径）。
func TestOfferingSessionNullCodeRead(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	// 依赖表（teaching_classes 归 user 模块、classrooms 归 classroom 模块）
	// 不在 course.Store.Migrate 范围内，直接 raw SQL 准备，用后清理。
	tcName := "测试无代码开课教学班"
	roomName := "测试无代码教室"
	cleanRef := func() {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM teaching_classes WHERE name = ?`, tcName)
		_, _ = s.db.ExecContext(ctx, `DELETE FROM classrooms WHERE name = ?`, roomName)
	}
	cleanRef()
	defer cleanRef()

	res, err := s.db.ExecContext(ctx, `INSERT INTO teaching_classes (name) VALUES (?)`, tcName)
	if err != nil {
		t.Fatalf("insert teaching_class: %v", err)
	}
	tcID, _ := res.LastInsertId()
	res, err = s.db.ExecContext(ctx, `INSERT INTO classrooms (name, capacity) VALUES (?, 0)`, roomName)
	if err != nil {
		t.Fatalf("insert classroom: %v", err)
	}
	roomID, _ := res.LastInsertId()

	catName := "测试无代码课程-开课读侧"
	// 清理同名历史数据（name 唯一，重跑安全）。
	if rows, err := s.ListCatalog(ctx); err == nil {
		for _, c := range rows {
			if c.Name == catName {
				_ = s.DeleteCatalog(ctx, c.ID)
			}
		}
	}
	c, err := s.CreateCatalog(ctx, CatalogInput{Name: catName})
	if err != nil {
		t.Fatalf("CreateCatalog: %v", err)
	}
	defer func() { _ = s.DeleteCatalog(ctx, c.ID) }()

	off, err := s.CreateOffering(ctx, OfferingInput{
		CatalogID:       c.ID,
		TeachingClassID: tcID,
		Teacher:         "测试教师",
		Semester:        "2099-2099-1",
	})
	if err != nil {
		t.Fatalf("CreateOffering: %v", err)
	}
	defer func() { _ = s.DeleteOffering(ctx, off.ID) }()

	ses, err := s.CreateSession(ctx, SessionInput{
		OfferingID:  off.ID,
		ClassroomID: roomID,
		Date:        "2099-01-05",
		PeriodStart: 1,
		PeriodEnd:   2,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	defer func() { _ = s.DeleteSession(ctx, ses.ID) }()

	if off.CatalogCode != "" {
		t.Errorf("CreateOffering 返回 CatalogCode = %q，期望空串", off.CatalogCode)
	}
	got, err := s.GetOffering(ctx, off.ID)
	if err != nil {
		t.Fatalf("GetOffering: %v", err)
	}
	if got.CatalogCode != "" {
		t.Errorf("GetOffering CatalogCode = %q，期望空串（NULL 读侧兜底）", got.CatalogCode)
	}
	gotSes, err := s.GetSession(ctx, ses.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if gotSes.CatalogCode != "" {
		t.Errorf("GetSession CatalogCode = %q，期望空串（NULL 读侧兜底）", gotSes.CatalogCode)
	}
	list, err := s.ListSessions(ctx, off.ID, 0, "", "")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(list) != 1 || list[0].CatalogCode != "" {
		t.Errorf("ListSessions CatalogCode = %v，期望 1 行且为空串", list)
	}
}
