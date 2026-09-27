package jwc

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"ocm-backend/internal/classroom"
	"ocm-backend/internal/schedule"
	"ocm-backend/internal/xlsx"
)

// Files 是拆分产出的 6 张规范 xlsx（字节），每张匹配对应 importer 的列契约。
// 调用方（importer handler）负责 base64 编码后建 6 个 import job。
type Files struct {
	Classrooms      []byte
	Catalog         []byte
	AdminClasses    []byte
	TeachingClasses []byte
	Offerings       []byte
	Sessions        []byte
}

// Stats 汇总拆分计数与跳过/告警，供端点返回给前端展示。
type Stats struct {
	Rows              int      `json:"rows"`              // 源表数据行数
	Classrooms        int      `json:"classrooms"`        // 去重后教室数
	CatalogCourses    int      `json:"catalogCourses"`    // 去重后课程数
	AdminClasses      int      `json:"adminClasses"`      // 去重后行政班数
	TeachingClasses   int      `json:"teachingClasses"`   // 教学班数
	Offerings         int      `json:"offerings"`         // 开课数
	Sessions          int      `json:"sessions"`          // 展开后课次数
	SkippedEmptyAdmin int      `json:"skippedEmptyAdmin"` // 空行政班跳过的开课数
	SkippedParallel   int      `json:"skippedParallel"`   // 平行教学班跳过的开课数
	NoTeacherFilled   int      `json:"noTeacherFilled"`   // 无教师已填「未安排」的开课数
	Warnings          []string `json:"warnings"`          // 人类可读告警
}

// Result 是 Split 的返回：6 张 xlsx + 统计。
type Result struct {
	Files Files
	Stats Stats
}

// maxBusinessWeekSpan 是单条起止周的业务告警阈值（一学期约 20~30 周）。
// expandWeeks 的 maxWeek=30 是硬上界（超界直接解析错误、槽位跳过）；跨度
// 27~30 周仍能解析但记本告警（不阻断），提示疑似跨学期脏数据。
const maxBusinessWeekSpan = 26

// Split 把教务处 xlsx 拆分为 6 张规范 xlsx。
//
// 入参：data 为教务处 xlsx 字节；semester 为学期标签（如 2024-2025-2）；week1Monday
// 为该学期第一周周一（必须是周一）；regimes 为已加载的作息制度，用于预校验展开日期。
//
// 致命错误（表头缺失、入参非法、文件无法解析、产出为空、作息未覆盖）以 error 返回且不产出文件；
// 行级问题（空行政班、平行教学班、无教师、节次/起止周解析失败）记入 Stats.Warnings
// 并跳过相关开课/课次，不中断整体拆分。
func Split(data []byte, semester string, week1Monday time.Time, regimes []schedule.Regime) (*Result, error) {
	semester = strings.TrimSpace(semester)
	if semester == "" {
		return nil, errors.New("学期标签为空")
	}
	if week1Monday.IsZero() {
		return nil, errors.New("第一周周一未设置")
	}
	if week1Monday.Weekday() != time.Monday {
		return nil, fmt.Errorf("第一周周一须为周一，传入为 %s", week1Monday.Weekday().String())
	}

	rows, parseWarnings, err := parseRows(data)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errors.New("教务处表格无数据行")
	}

	st := Stats{Rows: len(rows), Warnings: parseWarnings}

	// 1. 按课程序号分组（合并合班上课的同槽位多教师行）。
	seqs := groupBySeq(rows, &st)

	// 2-4. 全局基础数据：教室、课程库、行政班。
	rooms := buildClassrooms(rows)
	catalog := buildCatalog(rows, &st)
	adminGrades := buildAdminGrades(rows)

	// 5. 平行教学班检测：同 (课程代码, 行政班集合) 多课程序号 -> 跳过。
	markParallel(seqs, &st)

	// 6. 教学班（仅含有行政班且未跳过的开课对应的行政班集合）。
	tcs := buildTeachingClasses(seqs, &st)

	// 7. 开课 + 课次展开。
	offerings, sessions := buildOfferingsSessions(seqs, tcs, semester, week1Monday, &st)

	// 产出为空说明文件内容无效（全空序号/全停课/全解析失败），fail-fast 不建任务。
	if len(offerings) == 0 {
		return nil, fmt.Errorf("拆分结果为空：未解析出任何有效开课（共 %d 行）。%s", len(rows), firstWarnings(st.Warnings, 5))
	}
	if len(sessions) == 0 {
		return nil, fmt.Errorf("拆分结果为空：%d 个开课均未生成课次（节次/起止周/教室可能全部无效或全部停课）。%s", len(offerings), firstWarnings(st.Warnings, 5))
	}

	// 8. 作息制度预校验：每个展开日期都要有 active regime 且含所用节次。
	if err := validateRegimes(sessions, regimes); err != nil {
		return nil, fmt.Errorf("作息制度未覆盖：%w", err)
	}

	// 8.5 作息漂移告警：首周与最早/最晚课次日期落入不同作息制度时提示。
	// 学期内正常的作息切换（如冬夏令时）与跨学期脏数据都会命中，文案保持中性。
	warnRegimeDrift(sessions, regimes, week1Monday, &st)

	// 9. 生成 6 张 xlsx。
	f, err := buildFiles(rooms, catalog, adminGrades, tcs, offerings, sessions)
	if err != nil {
		return nil, err
	}
	st.Classrooms = len(rooms)
	st.CatalogCourses = len(catalog)
	st.AdminClasses = len(adminGrades)
	st.TeachingClasses = len(tcs)
	st.Offerings = len(offerings)
	st.Sessions = len(sessions)
	return &Result{Files: f, Stats: st}, nil
}

// ---- 中间结构 ----

// slot 是一个周槽位：某教室在星期 weekday 的节次区间 [periodStart, periodEnd]
// （连上多节），覆盖 weeks 周。
type slot struct {
	classroom   string
	weekday     int
	periodStart int
	periodEnd   int
	weeks       []int
	srcRow      int // 教务处源表行号：透传进 sessions 产物的 source_row 列
}

// slotKeyMeta 记录一个已见槽位键的原始文本与首行行号：原始文本用于区分
// 「同文本重复行」（合班多教师行，静默去重）与「语义等价但写法不同」的
// 重复排课（记告警）；行号用于告警定位。
type slotKeyMeta struct {
	raw      string
	firstRow int
}

// joinInts 把升序周集序列化为规范字符串，供归一化槽位键使用。
func joinInts(ns []int) string {
	parts := make([]string, len(ns))
	for i, n := range ns {
		parts[i] = fmt.Sprintf("%d", n)
	}
	return strings.Join(parts, ",")
}

// teacher 是一个去重后的教师（按工号去重）。
type teacher struct {
	id    string
	name  string
	title string
}

// seqGroup 是一个课程序号对应的开课：固定课程/行政班集合，含若干槽位与教师集合。
type seqGroup struct {
	seq         string
	courseCode  string
	courseName  string
	members     []string // 解析后的行政班成员；任选课为空
	adminKey    string   // 行政班集合规范键；任选课为空
	college     string
	maxStudents string
	requirement string
	weeklyHours string
	credits     string
	totalHours  string
	category    string
	examType    string
	grade       string
	slots       []*slot
	slotSeen    map[string]*slotKeyMeta
	teachers    map[string]teacher // key = teacherID（空则用姓名）
	teacherOrd  []string
	skipped     bool // 平行/空行政班等导致跳过
	skipReason  string
	firstRow    int // 首行行号：组级告警（空行政班/无课次/平行班）的定位线索
}

func newSeqGroup(r jwcRow) *seqGroup {
	g := &seqGroup{
		seq:         r.courseSeq,
		firstRow:    r.rowNum,
		courseCode:  r.courseCode,
		courseName:  r.courseName,
		college:     r.college,
		maxStudents: r.maxStudents,
		requirement: r.requirement,
		weeklyHours: r.weeklyHours,
		credits:     r.credits,
		totalHours:  r.totalHours,
		category:    r.category,
		examType:    r.examType,
		grade:       r.grade,
		slotSeen:    make(map[string]*slotKeyMeta),
		teachers:    make(map[string]teacher),
	}
	if members, ok := parseAdminSet(r.adminClasses); ok {
		g.members = members
		g.adminKey = adminSetKey(members)
	}
	return g
}

// groupBySeq 按课程序号聚合行，合并同槽位多教师（合班上课）。节次/起止周解析失败的行
// 记为告警并跳过该槽位。
func groupBySeq(rows []jwcRow, st *Stats) map[string]*seqGroup {
	seqs := make(map[string]*seqGroup)
	for _, r := range rows {
		if r.courseSeq == "" {
			st.Warnings = append(st.Warnings, fmt.Sprintf("第 %d 行：课程序号为空，跳过", r.rowNum))
			continue
		}
		g, ok := seqs[r.courseSeq]
		if !ok {
			g = newSeqGroup(r)
			seqs[r.courseSeq] = g
			// 数值脏数据告警：只查首行（产出值正来自首行，天然去重）。
			// 非空但非法才告警，空串是合法缺省（记 0）。
			if _, ok := atoiStrict(r.maxStudents); !ok {
				st.Warnings = append(st.Warnings,
					fmt.Sprintf("第 %d 行（%s）：人数上限 %q 不是合法数字，将记为 0", r.rowNum, r.courseSeq, r.maxStudents))
			}
			if _, ok := atoiStrict(r.weeklyHours); !ok {
				st.Warnings = append(st.Warnings,
					fmt.Sprintf("第 %d 行（%s）：周学时 %q 不是合法数字，将记为 0", r.rowNum, r.courseSeq, r.weeklyHours))
			}
			if _, ok := atofStrict(r.credits); !ok {
				st.Warnings = append(st.Warnings,
					fmt.Sprintf("第 %d 行（%s）：学分 %q 不是合法数字，将记为 0", r.rowNum, r.courseSeq, r.credits))
			}
			if _, ok := atoiStrict(r.totalHours); !ok {
				st.Warnings = append(st.Warnings,
					fmt.Sprintf("第 %d 行（%s）：总学时 %q 不是合法数字，将记为 0", r.rowNum, r.courseSeq, r.totalHours))
			}
			// 标识字段特殊字符告警：课程序号/课程代码/教师工号仅允许字母、数字
			// 与 . _ -（全角字符、破折号、#、/、空格等按脏数据处理）；教师工号
			// 可为逗号分隔的多值。空串合法缺省。告警不阻断：下游各 importer
			// 会在解析阶段对同类字段报 RowError 兜底拒绝。
			for _, chk := range []struct {
				field      string
				val        string
				multiValue bool
			}{
				{"课程序号", r.courseSeq, false},
				{"课程代码", r.courseCode, false},
				{"教师工号", r.teacherID, true},
			} {
				var msg string
				var ok bool
				if chk.multiValue {
					msg, ok = xlsx.CheckIdentifierList(chk.field, chk.val)
				} else {
					msg, ok = xlsx.CheckIdentifier(chk.field, chk.val)
				}
				if !ok {
					st.Warnings = append(st.Warnings,
						fmt.Sprintf("第 %d 行（%s）：%s", r.rowNum, r.courseSeq, msg))
				}
			}
		}
		// 教师（按工号去重；空工号空姓名的行不计入）。
		if r.teacherID != "" || r.teacherName != "" {
			key := r.teacherID
			if key == "" {
				key = "\x00" + r.teacherName
			}
			if _, exists := g.teachers[key]; !exists {
				g.teachers[key] = teacher{id: r.teacherID, name: r.teacherName, title: r.teacherTitle}
				g.teacherOrd = append(g.teacherOrd, key)
			}
		}
		// 先解析校验，再做 seen 查重：保证解析失败的行（含重复行）总是产生告警，
		// 不依赖 slotKey 构成恰好覆盖全部解析输入这一巧合。
		periodStart, periodEnd, perr := parsePeriods(r.periodStr)
		weeks, werr := expandWeeks(r.weekStr)
		if perr != nil {
			st.Warnings = append(st.Warnings, fmt.Sprintf("第 %d 行（%s）：%v", r.rowNum, r.courseSeq, perr))
			continue
		}
		if werr != nil {
			st.Warnings = append(st.Warnings, fmt.Sprintf("第 %d 行（%s）：%v", r.rowNum, r.courseSeq, werr))
			continue
		}
		// 周跨度业务告警：expandWeeks 已保证 weeks 非空且升序，len 判断为纯防御。
		if len(weeks) > 0 && weeks[len(weeks)-1]-weeks[0]+1 > maxBusinessWeekSpan {
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行（%s）：起止周跨度 %d 周超出正常学期长度，请核对是否为跨学期数据",
					r.rowNum, r.courseSeq, weeks[len(weeks)-1]-weeks[0]+1))
		}
		if r.weekday < 1 || r.weekday > 7 {
			st.Warnings = append(st.Warnings, fmt.Sprintf("第 %d 行（%s）：星期 %d 非法", r.rowNum, r.courseSeq, r.weekday))
			continue
		}
		if r.classroom == "" {
			st.Warnings = append(st.Warnings, fmt.Sprintf("第 %d 行（%s）：上课教室为空", r.rowNum, r.courseSeq))
			continue
		}
		// 解析全部通过后构造归一化槽位键：用解析后的成分（周集为 expandWeeks
		// 输出的升序去重集），使「1-16」与「[1-16]」「1-8,9-16」等语义等价的
		// 不同写法归并为同一槽位。若按原始文本作键，这类行会逃过去重、双重
		// 展开，在 sessions 导入时误报「本文件内重复占用该教室+日期+节次」。
		slotKey := fmt.Sprintf("%s|%d|%d|%d|%s", r.classroom, r.weekday, periodStart, periodEnd, joinInts(weeks))
		rawSlot := r.periodStr + "\x00" + r.weekStr
		// 重复行去重（合班多教师行语义）：原始文本一致的静默去重；语义等价
		// 但写法不同的记告警（带两处行号），提示源表存在重复排课表述。
		if meta, seen := g.slotSeen[slotKey]; seen {
			if meta.raw != rawSlot {
				st.Warnings = append(st.Warnings, fmt.Sprintf(
					"第 %d 行（%s）：与第 %d 行为同一教室/星期/节次/周的等价写法（节次 %q、起止周 %q），仅保留一次",
					r.rowNum, r.courseSeq, meta.firstRow, r.periodStr, r.weekStr))
			}
			continue
		}
		g.slotSeen[slotKey] = &slotKeyMeta{raw: rawSlot, firstRow: r.rowNum}
		if isNonPhysicalClassroom(r.classroom) {
			// 停课等占位标记：不生成课次，也不计为教室。
			continue
		}
		g.slots = append(g.slots, &slot{
			classroom:   r.classroom,
			weekday:     r.weekday,
			periodStart: periodStart,
			periodEnd:   periodEnd,
			weeks:       weeks,
			srcRow:      r.rowNum,
		})
	}
	return seqs
}

// classroomRec 是去重后的教室记录。
type classroomRec struct {
	name     string
	building string
	capacity string
	typ      string
	floor    string
	campus   string
	srcRow   int // 教务处源表 Excel 行号（首现行），写入产物 source_row 列
}

// roomTypeMap 把教务处「教室类型」映射为系统 classroom.type 英文键。
var roomTypeMap = map[string]string{
	"多媒体教室": classroom.TypeMultimedia,
	"机房":    classroom.TypeComputer,
	"实验室":   classroom.TypeLab,
	"体育场":   classroom.TypeStadium,
	"制图教室":  classroom.TypeDrawing,
	"听力教室":  classroom.TypeLanguage,
	"画室":    classroom.TypeStudio,
	"专用教室":  classroom.TypeSpecial,
	"":      classroom.TypeStandard,
}

func mapRoomType(s string) string {
	if t, ok := roomTypeMap[s]; ok {
		return t
	}
	return classroom.TypeStandard
}

// nonPhysicalClassrooms 是教务处表中非真实教室的占位标记。「停课」表示该时段停课，
// 既非教室也不应展开为课次；拆分时跳过其槽位与教室记录。
var nonPhysicalClassrooms = map[string]bool{"停课": true}

func isNonPhysicalClassroom(s string) bool { return nonPhysicalClassrooms[s] }

// buildClassrooms 按上课教室去重，取首次出现的楼宇/楼层/校区/容量/类型。停课等占位
// 标记不计入教室。
func buildClassrooms(rows []jwcRow) []classroomRec {
	m := make(map[string]classroomRec)
	order := []string{}
	for _, r := range rows {
		if r.classroom == "" || isNonPhysicalClassroom(r.classroom) {
			continue
		}
		if _, ok := m[r.classroom]; ok {
			continue
		}
		m[r.classroom] = classroomRec{
			name:     r.classroom,
			building: r.building,
			capacity: r.roomCapacity,
			typ:      mapRoomType(r.roomType),
			floor:    r.floor,
			campus:   r.campus,
			srcRow:   r.rowNum,
		}
		order = append(order, r.classroom)
	}
	out := make([]classroomRec, 0, len(order))
	for _, name := range order {
		out = append(out, m[name])
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

// catalogRec 是去重后的课程记录（按课程代码去重）。
type catalogRec struct {
	name       string
	code       string
	credits    string
	totalHours string
	category   string
	examType   string
	srcRow     int // 教务处源表 Excel 行号（首现行），写入产物 source_row 列
}

// buildCatalog 按课程代码去重（取首次出现的名称/属性）；课程代码缺失时退化为按名称去重，
// 并注入信息性告警（无代码课程按“活动类”课程导入，不阻断）。
func buildCatalog(rows []jwcRow, st *Stats) []catalogRec {
	m := make(map[string]catalogRec)
	order := []string{}
	for _, r := range rows {
		if r.courseName == "" {
			continue
		}
		key := r.courseCode
		if key == "" {
			key = "n:" + r.courseName // 无代码时按名称去重
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行：课程 %s 无课程代码，将按无代码（活动类）课程导入", r.rowNum, r.courseName))
		}
		if _, ok := m[key]; ok {
			continue
		}
		// 数值脏数据告警（仅首次出现的课程记一条）。
		if _, ok := atofStrict(r.credits); !ok {
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行：课程 %s 学分 %q 不是合法数字，将记为 0", r.rowNum, r.courseName, r.credits))
		}
		if _, ok := atoiStrict(r.totalHours); !ok {
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行：课程 %s 总学时 %q 不是合法数字，将记为 0", r.rowNum, r.courseName, r.totalHours))
		}
		m[key] = catalogRec{
			name:       r.courseName,
			code:       r.courseCode,
			credits:    r.credits,
			totalHours: r.totalHours,
			category:   r.category,
			examType:   r.examType,
			srcRow:     r.rowNum,
		}
		order = append(order, key)
	}
	out := make([]catalogRec, 0, len(order))
	for _, k := range order {
		out = append(out, m[k])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].code != out[j].code {
			return out[i].code < out[j].code
		}
		return out[i].name < out[j].name
	})
	return out
}

// adminClassRec 是去重后的行政班记录：年级取首次非空年级列（否则由班名推导），
// srcRow 记录该班首次出现的源表 Excel 行号（溯源列）。
type adminClassRec struct {
	grade  string
	srcRow int
}

// buildAdminGrades 收集全局行政班 -> 记录（取首次非空年级列，否则由班名推导）。
func buildAdminGrades(rows []jwcRow) map[string]adminClassRec {
	m := make(map[string]adminClassRec)
	for _, r := range rows {
		members, ok := parseAdminSet(r.adminClasses)
		if !ok {
			continue
		}
		for _, a := range members {
			if _, exists := m[a]; !exists {
				m[a] = adminClassRec{grade: gradeFor(a, r.grade), srcRow: r.rowNum}
			}
		}
	}
	return m
}

// markParallel 检测平行教学班：同 (课程代码, 行政班集合) 出现 ≥2 课程序号 -> 全部跳过。
func markParallel(seqs map[string]*seqGroup, st *Stats) {
	type pair struct{ code, adminKey string }
	groups := make(map[pair][]string) // pair -> seqs
	for seq, g := range seqs {
		if g.adminKey == "" {
			continue // 空行政班另行处理
		}
		groups[pair{g.courseCode, g.adminKey}] = append(groups[pair{g.courseCode, g.adminKey}], seq)
	}
	for _, ss := range groups {
		if len(ss) < 2 {
			continue
		}
		sort.Strings(ss)
		for _, seq := range ss {
			seqs[seq].skipped = true
			seqs[seq].skipReason = "平行教学班"
			st.SkippedParallel++
		}
		parts := make([]string, len(ss))
		for i, seq := range ss {
			parts[i] = fmt.Sprintf("%s（第 %d 行）", seq, seqs[seq].firstRow)
		}
		st.Warnings = append(st.Warnings,
			fmt.Sprintf("平行教学班（同课程代码+行政班集合多序号）跳过 %d 个：%s", len(ss), strings.Join(parts, "、")))
	}
}

// teachingClass 是一个教学班：合成名 + 成员 + note（回退时非空）+ 溯源行号。
type teachingClass struct {
	name    string
	note    string
	members []string
	srcRow  int // 首个形成该教学班的开课的源表 Excel 行号，写入产物 source_row 列
}

// buildTeachingClasses 为未跳过且有行政班的开课构造教学班（按行政班集合去重）。
func buildTeachingClasses(seqs map[string]*seqGroup, st *Stats) []teachingClass {
	m := make(map[string]teachingClass)
	order := []string{}
	// 按课程序号排序迭代：同一行政班集合被多个未跳过序号共享时（不同课程同班），
	// 首个序号决定溯源行号，排序保证结果可重复。
	keys := make([]string, 0, len(seqs))
	for seq := range seqs {
		keys = append(keys, seq)
	}
	sort.Strings(keys)
	for _, seq := range keys {
		g := seqs[seq]
		if g.skipped || g.adminKey == "" {
			continue
		}
		if _, exists := m[g.adminKey]; exists {
			continue
		}
		name, note := teachingClassName(g.members)
		m[g.adminKey] = teachingClass{name: name, note: note, members: g.members, srcRow: g.firstRow}
		order = append(order, g.adminKey)
	}
	out := make([]teachingClass, 0, len(order))
	for _, k := range order {
		out = append(out, m[k])
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

// offeringRec 是一个开课记录（匹配 offerings importer 列契约）。
type offeringRec struct {
	course        string
	teachingClass string
	semester      string
	teacher       string
	courseSeq     string
	teacherID     string
	teacherTitle  string
	college       string
	maxStudents   string
	requirement   string
	weeklyHours   string
	note          string
	srcRow        int // 教务处源表 Excel 行号（序号首行），写入产物 source_row 列
}

// sessionRec 是一个课次记录（匹配 sessions importer 列契约）。连上多节的槽位
// 保持为一个记录（period_start..period_end），不逐节展开。
type sessionRec struct {
	date          string
	periodStart   int
	periodEnd     int
	classroom     string
	course        string
	teachingClass string
	semester      string
	srcRow        int // 教务处源表行号，写入产物 source_row 列（溯源用）
}

// buildOfferingsSessions 为未跳过且有行政班的开课生成 offering 与展开后的 sessions。
// 无教师的开课填「未安排」并告警；空行政班开课跳过 offering/session 并告警。
func buildOfferingsSessions(
	seqs map[string]*seqGroup,
	tcs []teachingClass,
	semester string,
	week1Monday time.Time,
	st *Stats,
) ([]offeringRec, []sessionRec) {
	// 教学班名查找表（按 adminKey）。
	tcName := make(map[string]string)
	for _, g := range seqs {
		if g.skipped || g.adminKey == "" {
			continue
		}
		if _, ok := tcName[g.adminKey]; ok {
			continue
		}
		name, _ := teachingClassName(g.members)
		tcName[g.adminKey] = name
	}

	// 按课程序号排序输出，保证可重复。
	seqList := make([]string, 0, len(seqs))
	for seq := range seqs {
		seqList = append(seqList, seq)
	}
	sort.Strings(seqList)

	var offerings []offeringRec
	var sessions []sessionRec
	for _, seq := range seqList {
		g := seqs[seq]
		if g.skipped {
			continue
		}
		if g.adminKey == "" {
			st.SkippedEmptyAdmin++
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行：空行政班开课跳过（任选课）：%s %s", g.firstRow, g.seq, g.courseName))
			continue
		}
		// 教师合并（按工号排序，去重）。
		teachers := make([]teacher, 0, len(g.teacherOrd))
		for _, k := range g.teacherOrd {
			teachers = append(teachers, g.teachers[k])
		}
		sort.Slice(teachers, func(i, j int) bool {
			if teachers[i].id != teachers[j].id {
				return teachers[i].id < teachers[j].id
			}
			return teachers[i].name < teachers[j].name
		})
		teacherName, teacherID, teacherTitle := joinTeachers(teachers)
		if teacherName == "" {
			teacherName = "未安排"
			st.NoTeacherFilled++
		}
		off := offeringRec{
			course:        g.courseName,
			teachingClass: tcName[g.adminKey],
			semester:      semester,
			teacher:       teacherName,
			courseSeq:     g.seq,
			teacherID:     teacherID,
			teacherTitle:  teacherTitle,
			college:       g.college,
			maxStudents:   g.maxStudents,
			requirement:   g.requirement,
			weeklyHours:   g.weeklyHours,
			note:          g.seq,
			srcRow:        g.firstRow,
		}
		offerings = append(offerings, off)

		// 展开槽位为课次：每周一个课次，节次保持区间（连上多节不拆分）。
		sessionsBefore := len(sessions)
		for _, s := range g.slots {
			cells := expandSlot(s.classroom, s.weekday, s.periodStart, s.periodEnd, s.weeks, week1Monday)
			for _, c := range cells {
				sessions = append(sessions, sessionRec{
					date:          c.date,
					periodStart:   c.periodStart,
					periodEnd:     c.periodEnd,
					classroom:     c.classroom,
					course:        g.courseName,
					teachingClass: tcName[g.adminKey],
					semester:      semester,
					srcRow:        s.srcRow,
				})
			}
		}
		// 0 课次开课（orphan offering）告警：行级告警说明原因（如起止周非法、
		// 教室全为「停课」占位），本告警说明后果（该开课将无任何课次），颗粒度
		// 不同、并存不重复。不阻断：开课仍产出，由操作员决定是否继续。
		if len(sessions) == sessionsBefore {
			st.Warnings = append(st.Warnings,
				fmt.Sprintf("第 %d 行：开课「%s」（序号 %s）未生成任何课次，请检查节次/起止周/教室设置", g.firstRow, g.courseName, g.seq))
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].date != sessions[j].date {
			return sessions[i].date < sessions[j].date
		}
		if sessions[i].periodStart != sessions[j].periodStart {
			return sessions[i].periodStart < sessions[j].periodStart
		}
		if sessions[i].periodEnd != sessions[j].periodEnd {
			return sessions[i].periodEnd < sessions[j].periodEnd
		}
		return sessions[i].classroom < sessions[j].classroom
	})
	return offerings, sessions
}

// joinTeachers 把教师列表合并为三个逗号连接的字符串（姓名/工号/职称，按同序对齐）。
func joinTeachers(ts []teacher) (names, ids, titles string) {
	if len(ts) == 0 {
		return "", "", ""
	}
	nb := make([]string, len(ts))
	ib := make([]string, len(ts))
	tb := make([]string, len(ts))
	for i, t := range ts {
		nb[i] = t.name
		ib[i] = t.id
		tb[i] = t.title
	}
	return strings.Join(nb, ","), strings.Join(ib, ","), strings.Join(tb, ",")
}

// firstWarnings 拼接前 n 条告警，供 fail-fast 错误附上定位线索。
func firstWarnings(ws []string, n int) string {
	if len(ws) == 0 {
		return ""
	}
	if len(ws) > n {
		ws = ws[:n]
	}
	return "\n近期告警：\n" + strings.Join(ws, "\n")
}

// warnRegimeDrift 对比首周作息与最早/最晚课次日期的作息，不一致仅告警不阻断。
// ActiveFor 按月日匹配、忽略年份，且在无早于目标日期的制度时回退 latest 并
// 返回 ok=true；空 regimes 已被 validateRegimes fail-fast 拦截，此处守卫为纯防御。
// sessions 已按日期升序（buildOfferingsSessions 排序），端点即 min/max。
func warnRegimeDrift(sessions []sessionRec, regimes []schedule.Regime, week1Monday time.Time, st *Stats) {
	if len(sessions) == 0 {
		return
	}
	firstRegime, ok := schedule.ActiveFor(regimes, week1Monday)
	if !ok {
		return
	}
	minDate, maxDate := sessions[0].date, sessions[len(sessions)-1].date
	for _, d := range []string{minDate, maxDate} {
		date, err := time.Parse("2006-01-02", d)
		if err != nil {
			continue
		}
		if r, ok2 := schedule.ActiveFor(regimes, date); ok2 && r.Name != firstRegime.Name {
			st.Warnings = append(st.Warnings, fmt.Sprintf(
				"课次日期 %s 对应的作息制度为「%s」，与首周作息制度「%s」不一致（请确认是否为作息切换或跨学期数据）",
				d, r.Name, firstRegime.Name))
		}
	}
}

// validateRegimes 预校验：每个展开日期都要有 active regime，且 regime 含该日期用到的节次。
// 不满足则返回错误（列出首批违规日期），fail-fast 避免建任务后才发现。
func validateRegimes(sessions []sessionRec, regimes []schedule.Regime) error {
	periodsByDate := make(map[string]map[int]bool)
	for _, s := range sessions {
		set, ok := periodsByDate[s.date]
		if !ok {
			set = make(map[int]bool)
			periodsByDate[s.date] = set
		}
		for p := s.periodStart; p <= s.periodEnd; p++ {
			set[p] = true
		}
	}
	var bad []string
	dates := make([]string, 0, len(periodsByDate))
	for d := range periodsByDate {
		dates = append(dates, d)
	}
	sort.Strings(dates) // 固定报错顺序（map 遍历无序）
	for _, dstr := range dates {
		periods := periodsByDate[dstr]
		date, err := time.Parse("2006-01-02", dstr)
		if err != nil {
			continue
		}
		regime, ok := schedule.ActiveFor(regimes, date)
		if !ok {
			bad = append(bad, fmt.Sprintf("%s 无作息制度", dstr))
			continue
		}
		valid := schedule.PeriodIndexSet(regime)
		for p := range periods {
			if !valid[p] {
				bad = append(bad, fmt.Sprintf("%s 节次 %d 不在作息制度「%s」", dstr, p, regime.Name))
				break
			}
		}
		if len(bad) >= 5 {
			break
		}
	}
	if len(bad) > 0 {
		return errors.New(strings.Join(bad, "\n"))
	}
	return nil
}

// ---- xlsx 生成 ----

// buildFiles 生成 6 张规范 xlsx。任一 excelize 编码失败即返回错误（不 panic），
// 由 Split 上抛，jwcSplit 将其转为 400 返回前端。BuildBytes 仅在 excelize
// 内部错误时失败，此前各 emit* 用 panic 终止——会让裸 goroutine 路径崩溃
// 整个进程，故改为错误返回。
func buildFiles(rooms []classroomRec, catalog []catalogRec, adminGrades map[string]adminClassRec, tcs []teachingClass, ofs []offeringRec, ss []sessionRec) (Files, error) {
	var f Files
	var err error
	if f.Classrooms, err = emitClassrooms(rooms); err != nil {
		return Files{}, fmt.Errorf("生成教室表失败：%w", err)
	}
	if f.Catalog, err = emitCatalog(catalog); err != nil {
		return Files{}, fmt.Errorf("生成课程目录表失败：%w", err)
	}
	if f.AdminClasses, err = emitAdminClasses(adminGrades); err != nil {
		return Files{}, fmt.Errorf("生成行政班表失败：%w", err)
	}
	if f.TeachingClasses, err = emitTeachingClasses(tcs, adminGrades); err != nil {
		return Files{}, fmt.Errorf("生成教学班表失败：%w", err)
	}
	if f.Offerings, err = emitOfferings(ofs); err != nil {
		return Files{}, fmt.Errorf("生成开课表失败：%w", err)
	}
	if f.Sessions, err = emitSessions(ss); err != nil {
		return Files{}, fmt.Errorf("生成课次表失败：%w", err)
	}
	return f, nil
}

func emitClassrooms(rs []classroomRec) ([]byte, error) {
	headers := []string{"name", "building", "capacity", "type", "floor", "campus", "status", "description", "source_row"}
	rows := make([][]any, 0, len(rs))
	for _, r := range rs {
		rows = append(rows, []any{r.name, r.building, r.capacity, r.typ, r.floor, r.campus, classroom.StatusAvailable, "", r.srcRow})
	}
	return xlsx.BuildBytes("classrooms", headers, rows)
}

func emitCatalog(cs []catalogRec) ([]byte, error) {
	headers := []string{"name", "code", "credits", "total_hours", "category", "exam_type", "description", "source_row"}
	rows := make([][]any, 0, len(cs))
	for _, c := range cs {
		rows = append(rows, []any{c.name, c.code, atofOr(c.credits, 0), atoiOr(c.totalHours, 0), c.category, c.examType, "", c.srcRow})
	}
	return xlsx.BuildBytes("catalog", headers, rows)
}

func emitAdminClasses(ag map[string]adminClassRec) ([]byte, error) {
	headers := []string{"grade", "name", "note", "source_row"}
	names := make([]string, 0, len(ag))
	for n := range ag {
		names = append(names, n)
	}
	sort.Strings(names)
	rows := make([][]any, 0, len(names))
	for _, n := range names {
		rows = append(rows, []any{ag[n].grade, n, "", ag[n].srcRow})
	}
	return xlsx.BuildBytes("admin_classes", headers, rows)
}

func emitTeachingClasses(tcs []teachingClass, adminGrades map[string]adminClassRec) ([]byte, error) {
	headers := []string{"name", "note", "admin_grade", "admin_name", "source_row"}
	var rows [][]any
	for _, tc := range tcs {
		for _, m := range tc.members {
			rows = append(rows, []any{tc.name, tc.note, adminGrades[m].grade, m, tc.srcRow})
		}
	}
	return xlsx.BuildBytes("teaching_classes", headers, rows)
}

func emitOfferings(ofs []offeringRec) ([]byte, error) {
	headers := []string{"course", "teaching_class", "semester", "teacher", "course_seq", "teacher_id", "teacher_title", "college", "max_students", "requirement", "weekly_hours", "note", "source_row"}
	rows := make([][]any, 0, len(ofs))
	for _, o := range ofs {
		rows = append(rows, []any{o.course, o.teachingClass, o.semester, o.teacher, o.courseSeq, o.teacherID, o.teacherTitle, o.college, atoiOr(o.maxStudents, 0), o.requirement, atoiOr(o.weeklyHours, 0), o.note, o.srcRow})
	}
	return xlsx.BuildBytes("offerings", headers, rows)
}

func emitSessions(ss []sessionRec) ([]byte, error) {
	// source_row 为末列溯源列（教务处源表 Excel 行号，表头占第 1 行）：MapRows
	// 按表头名映射、importer 端按名读取，位置无关，放末列便于人工阅读。六个
	// 拆分产物均带此列；可选列，不进 importer 的 requireColumns。
	headers := []string{"date", "period_start", "period_end", "classroom", "course", "teaching_class", "semester", "note", "source_row"}
	rows := make([][]any, 0, len(ss))
	for _, s := range ss {
		rows = append(rows, []any{s.date, s.periodStart, s.periodEnd, s.classroom, s.course, s.teachingClass, s.semester, "", s.srcRow})
	}
	return xlsx.BuildBytes("sessions", headers, rows)
}
