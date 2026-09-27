package jwc

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"ocm-backend/internal/xlsx"
)

// 教务处源表中文表头（xlsx.MapRows 已对表头做 lower-trim，中文无大小写变化，
// 故直接用中文原文作为列键，顺序无关）。
const (
	hBuilding     = "教学楼"
	hClassroom    = "上课教室"
	hRoomType     = "教室类型"
	hFloor        = "楼层"
	hWeekday      = "星期"
	hPeriod       = "节次"
	hWeeks        = "起止周"
	hCourseSeq    = "课程序号"
	hCourseCode   = "课程代码"
	hCourseName   = "课程名称"
	hAdminClasses = "行政班"
	hTeacherName  = "教师姓名"
	hTeacherTitle = "教师职称"
	hTeacherID    = "教师工号"
	hMaxStudents  = "人数上限"
	hCollege      = "开课学院"
	hRequirement  = "课程类别一"
	hCategory     = "课程类别二"
	hTotalHours   = "总学时"
	hWeeklyHours  = "周学时"
	hCredits      = "学分"
	hExamType     = "考核方式"
	hGrade        = "年级"
	hCampus       = "校区"
	hRoomCapacity = "教室人数"
)

// requiredHeaders 是拆分必需的中文表头，缺任一列说明上传的不是教务处课表。
var requiredHeaders = []string{hCourseSeq, hCourseName, hAdminClasses, hWeekday, hPeriod, hWeeks, hClassroom}

// consumedHeaders 是产出文件会实际消费、但缺失不足以判定“非教务处课表”的列。
// 缺失时向 Stats.Warnings 注入列级告警（不 fail-fast），避免容量/学分等字段
// 静默归 0 而操作员在 split 阶段无从感知。
//
// 校区/教师职称/人数上限/周学时 四列同样被消费（campus → classrooms，
// teacher_title/max_students/weekly_hours → offerings），但缺列不在此告警：
// 源课表本就存在无这些列的正常导出形态（对应导入器均定义为可选列，缺列时
// 照常留空或记 0），告警纯属噪音。
var consumedHeaders = []string{
	hBuilding, hRoomType, hFloor, hRoomCapacity,
	hTeacherName, hTeacherID,
	hCollege, hRequirement,
	hCourseCode, hCredits, hTotalHours, hCategory, hExamType, hGrade,
}

// jwcRow 是教务处源表一行的强类型视图。数值列保留原始字符串由后续阶段按需解析，
// 便于在解析失败时定位到具体行。
type jwcRow struct {
	building     string
	classroom    string
	roomType     string
	floor        string
	weekday      int
	periodStr    string
	weekStr      string
	courseSeq    string
	courseCode   string
	courseName   string
	adminClasses string
	teacherName  string
	teacherTitle string
	teacherID    string
	maxStudents  string
	college      string
	requirement  string
	category     string
	totalHours   string
	weeklyHours  string
	credits      string
	examType     string
	grade        string
	campus       string
	roomCapacity string
	rowNum       int // 1-based 文件行号，用于错误定位
}

// parseRows 读教务处 xlsx 首 sheet，按中文表头映射为 jwcRow。返回的行保留全部源行
// （含空行政班行、解析失败的星期行），由后续阶段决定跳过还是报错。仅当表头缺失或
// 文件无法打开时返回错误。
func parseRows(data []byte) (rows []jwcRow, warnings []string, err error) {
	headers, recs, err := xlsx.MapRows(data)
	if err != nil {
		return nil, nil, fmt.Errorf("读取教务处 xlsx 失败：%w", err)
	}
	var missing []string
	for _, h := range requiredHeaders {
		if !xlsx.Has(headers, h) {
			missing = append(missing, h)
		}
	}
	if len(missing) > 0 {
		return nil, nil, fmt.Errorf("缺少必需列：%s（请确认上传的是教务处课表）", strings.Join(missing, "、"))
	}
	for _, h := range consumedHeaders {
		if !xlsx.Has(headers, h) {
			warnings = append(warnings,
				fmt.Sprintf("缺少列「%s」：相关字段将留空或记为 0，请核对导出模板", h))
		}
	}
	for i, rec := range recs {
		rows = append(rows, jwcRow{
			building:     rec[hBuilding],
			classroom:    rec[hClassroom],
			roomType:     rec[hRoomType],
			floor:        rec[hFloor],
			weekday:      atoiOr(rec[hWeekday], 0),
			periodStr:    rec[hPeriod],
			weekStr:      rec[hWeeks],
			courseSeq:    rec[hCourseSeq],
			courseCode:   rec[hCourseCode],
			courseName:   rec[hCourseName],
			adminClasses: rec[hAdminClasses],
			teacherName:  rec[hTeacherName],
			teacherTitle: rec[hTeacherTitle],
			teacherID:    rec[hTeacherID],
			maxStudents:  rec[hMaxStudents],
			college:      rec[hCollege],
			requirement:  rec[hRequirement],
			category:     rec[hCategory],
			totalHours:   rec[hTotalHours],
			weeklyHours:  rec[hWeeklyHours],
			credits:      rec[hCredits],
			examType:     rec[hExamType],
			grade:        rec[hGrade],
			campus:       rec[hCampus],
			roomCapacity: rec[hRoomCapacity],
			rowNum:       i + 2, // Excel 行号（表头占第 1 行），可在源文件中按数字直接定位
		})
	}
	return rows, warnings, nil
}

// atoiOr 解析整型，空或非法返回 def。jwc 包不依赖 importer 包，故本地提供。
func atoiOr(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// atofOr 解析浮点，空或非法返回 def。
func atofOr(s string, def float64) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return def
	}
	return n
}

// atoiStrict 解析整型；空串视为合法缺省 (0, true)，非空但非法返回 (0, false)。
// 与 atoiOr 的区别：非法值不静默吞掉，由调用方产出告警/行错误。
func atoiStrict(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

// atofStrict 同 atoiStrict，浮点版。strconv.ParseFloat 会接受 "inf"/"nan"
// （IEEE 754 特殊值且 err == nil）；这类值会污染数值列并在 Commit 的
// DECIMAL 写入时炸掉事务，故在此拒绝。与 importer 包同名函数语义一致。
func atofStrict(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}
