package ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"ocm-backend/internal/authz"
	"ocm-backend/internal/booking"
	"ocm-backend/internal/brand"
	"ocm-backend/internal/classroom"
	"ocm-backend/internal/course"
	"ocm-backend/internal/dbutil"
	"ocm-backend/internal/logging"
	"ocm-backend/internal/schedule"
)

// Loop and timeout bounds for one chat turn. The per-round deadline caps a
// single upstream request, the idle timer aborts a stream that goes silent
// (upstream SSE keep-alives reset it), and the total deadline bounds the
// whole multi-round tool loop.
const (
	maxRounds    = 5
	roundTimeout = 120 * time.Second
	totalTimeout = 10 * time.Minute
	idleTimeout  = 60 * time.Second

	// maxToolResultBytes caps one tool result handed to the model. Results are
	// appended to the turn's messages, so every later round re-sends them; the
	// real cost is this budget times the number of tool rounds, which is why it
	// stays in the low tens of KB instead of "whatever the context allows".
	maxToolResultBytes = 12000

	// envelopeReserve is headroom for the JSON envelope plus the truncation
	// note added after the list budget is computed (a note is ~60 Chinese
	// chars, i.e. under 200 bytes; the envelope keys are a few dozen).
	envelopeReserve = 400

	// maxToolListItems caps how many rows a list tool asks the store for. The
	// byte budget usually binds first; this is the guard for very compact rows.
	maxToolListItems = 200

	// maxToolErrorPreview bounds the failed-tool message echoed to the browser
	// (clients render only the status tag, so this exists for diagnosis).
	maxToolErrorPreview = 400
)

// Truncation notes. They are prose on purpose: the model relays them to the
// user, so a structured hint would be cheaper but would rarely surface.
const (
	classroomListNote = "共 %d 间教室匹配，此处给出 %d 间。缩小范围请传 building、type、capacityMin 或 q。"
	availableNote     = "共 %d 间空闲教室，此处给出 %d 间（含容量最小的与最大的各一部分）。缩小范围请传 building、type 或 capacityMin。"
	timetableNote     = "共 %d 节课，此处给出 %d 节（最早与最晚的各一部分）。请缩短日期范围，或用 date/weekOf 精确查询。"
)

// Tool is one assistant tool: its OpenAI function definition plus the
// server-side executor. Run returns a business result string (shown to the
// LLM, may be a permission denial) and a non-nil error only for
// infrastructure failures that should abort the turn.
type Tool struct {
	Name        string
	Description string
	Parameters  map[string]any
	Run         func(ctx context.Context, raw json.RawMessage) (result string, proposal *ProposalPayload, err error)
}

// ProposalPayload is the structured booking preview the frontend renders for
// human confirmation. Nothing is written to the database when a proposal is
// produced; the confirm button submits through the existing booking API.
type ProposalPayload struct {
	ClassroomID   int64                  `json:"classroomId"`
	ClassroomName string                 `json:"classroomName"`
	Date          string                 `json:"date"`
	PeriodStart   int                    `json:"periodStart"`
	PeriodEnd     int                    `json:"periodEnd"`
	PeriodLabel   string                 `json:"periodLabel"`
	Purpose       string                 `json:"purpose"`
	Conflicts     []booking.ConflictItem `json:"conflicts"`
}

// Agent drives one chat turn: it owns the system prompt, the tool registry
// and the multi-round tool-call loop, relaying every event through emit.
type Agent struct {
	client     *Client
	classrooms *classroom.Store
	regimes    *schedule.Store
	courses    *course.Store
	bookings   *booking.Store
	subject    authz.Subject

	// Turn-scoped regime snapshot: buildMessages loads it once for the
	// system prompt and validSlot validates against the same copy, so the
	// table the model was shown and the table enforcing its tool calls can
	// never disagree mid-turn. Agents are built per request, so this needs
	// no locking.
	turnRegimes       []schedule.Regime
	turnRegimesLoaded bool
}

func NewAgent(client *Client, classrooms *classroom.Store, regimes *schedule.Store,
	courses *course.Store, bookings *booking.Store, subject authz.Subject) *Agent {
	return &Agent{
		client:     client,
		classrooms: classrooms,
		regimes:    regimes,
		courses:    courses,
		bookings:   bookings,
		subject:    subject,
	}
}

var weekdayNames = [...]string{"日", "一", "二", "三", "四", "五", "六"}

// systemPrompt builds the turn's system prompt. Besides the current date it
// injects the bell-time regime table: the data is tiny, changes at term
// granularity, and nearly every question needs it to translate 时段 wording
// ("晚上") into concrete periods before any tool call — a tool round here
// would be pure overhead.
func systemPrompt(now time.Time, regimes []schedule.Regime) string {
	var b strings.Builder
	b.WriteString("你是「" + brand.Name() + " 智慧教室管理系统」的 AI 助手，帮助教师查询教室、课表与空闲时段，并生成教室预约方案。" +
		"今天是 " + now.Format("2006年01月02日") + " 星期" + weekdayNames[now.Weekday()] + "。\n")
	b.WriteString(regimeBlock(now, regimes))
	b.WriteString("请遵守以下规则：\n" +
		"1. 只能通过提供的工具查询真实数据，绝不编造任何数据；工具没有返回的信息一律视为不存在。\n" +
		"2. 教室预约只能通过 propose_booking 工具生成「预约预览」，然后等待用户在界面上点击确认；你绝不能代替用户提交任何操作，也绝不能声称已经完成预约。\n" +
		"3. 涉及相对日期（如“周一”“下周”）时，必须先换算成具体日期（YYYY-MM-DD）再调用工具，并在回答中写明。\n" +
		"4. 节次与时间以上方作息制度为准，不要凭空假设；涉及“上午”“下午”“晚上”等时段时，先按各节次的起止时间换算成具体节次区间再调用工具，工具会再次校验。\n" +
		"5. 如果某个工具因为用户没有权限而失败，请如实告知用户缺少什么权限，不要编造数据替代。\n" +
		"6. 回答使用中文，简洁准确；多项数据可用 Markdown 列表或表格呈现。")
	return b.String()
}

// regimeBlock renders the regime table for the system prompt. All regimes are
// listed — a conversation may reference dates across a regime switch — with
// the one active today called out using the same schedule.ActiveFor rule the
// tools validate against.
func regimeBlock(now time.Time, regimes []schedule.Regime) string {
	if len(regimes) == 0 {
		return "当前系统未配置作息制度，涉及节次的查询会失败，请如实告知用户需由管理员先配置作息制度。\n"
	}
	var b strings.Builder
	b.WriteString("作息制度（全校按各制度的生效起始日轮换，节次与时间以此为准）：\n")
	for _, r := range regimes {
		b.WriteString("- " + r.Name + fmt.Sprintf("（每年%d月%d日起生效）：", r.EffectiveMonth, r.EffectiveDay))
		parts := make([]string, 0, len(r.Periods))
		for _, p := range r.Periods {
			parts = append(parts, fmt.Sprintf("第%d节 %s-%s", p.PeriodIndex, p.StartTime, p.EndTime))
		}
		if len(parts) == 0 {
			b.WriteString("未配置节次")
		} else {
			b.WriteString(strings.Join(parts, "；"))
		}
		b.WriteString("\n")
	}
	active, _ := schedule.ActiveFor(regimes, now) // ok whenever regimes is non-empty
	b.WriteString("今天生效的是「" + active.Name + "」。涉及其他日期时，请按上述生效日判断该日期适用哪套制度。\n")
	return b.String()
}

// Definitions returns the OpenAI tool definitions for this turn. The tool set
// is fixed; each tool checks the calling user's permissions when executed.
func (a *Agent) Definitions() []ToolDef {
	return []ToolDef{
		NewToolDef("list_classrooms",
			"查询教室列表。可按最小容量、楼栋、教室类型或名称关键字筛选。返回教室的编号、名称、楼栋、容量、类型、楼层、校区与状态（available=可用）。结果有长度上限，超出时返回 total（匹配总数）、shown（实际条数）与说明，请据此缩小条件而不是重复查询。",
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"capacityMin": map[string]any{"type": "integer", "description": "最小容纳人数，如 50"},
					"building":    map[string]any{"type": "string", "description": "楼栋关键字，如“A”"},
					"type": map[string]any{"type": "string", "description": "教室类型",
						"enum": []string{"standard", "multimedia", "computer", "lab", "lecture_hall",
							"stadium", "drawing", "language", "studio", "special"}},
					"q":     map[string]any{"type": "string", "description": "教室名称关键字"},
					"limit": map[string]any{"type": "integer", "description": "最多返回多少条，可选（默认取上限）"},
				},
			}),
		NewToolDef("query_availability",
			"查询某一天某个节次区间内空闲且可用的教室（可同时按最小容量、楼栋、教室类型筛选）。空闲=该教室在该日期该节次区间没有课程（course session）也没有待审批/已通过的预约。必须提供具体日期（YYYY-MM-DD）与节次区间，节次必须是该日期生效作息制度中存在的节次。返回作息制度名称、节次对应时间与空闲教室列表；结果有长度上限，超出时返回 total/shown 与说明，请据此缩小条件。",
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"date":        map[string]any{"type": "string", "description": "日期，YYYY-MM-DD"},
					"periodStart": map[string]any{"type": "integer", "description": "起始节次，从 1 开始"},
					"periodEnd":   map[string]any{"type": "integer", "description": "结束节次（含）"},
					"capacityMin": map[string]any{"type": "integer", "description": "最小容纳人数，可选"},
					"building":    map[string]any{"type": "string", "description": "楼栋关键字，可选，如“A”"},
					"type": map[string]any{"type": "string", "description": "教室类型，可选",
						"enum": []string{"standard", "multimedia", "computer", "lab", "lecture_hall",
							"stadium", "drawing", "language", "studio", "special"}},
					"limit": map[string]any{"type": "integer", "description": "最多返回多少间，可选（默认取上限）"},
				},
				"required": []string{"date", "periodStart", "periodEnd"},
			}),
		NewToolDef("query_timetable",
			"查询课表：按教室或按关键字（教师姓名、课程名、教学班名、教室名）查询某日期范围内的上课安排。日期范围由 from/to（含）、weekOf（该周周一至周日）或 date（单日）之一给出。返回每节课的日期、星期、节次区间、课程名、教师、教学班与教室；结果有长度上限，超出时返回 total/shown 与说明。",
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"classroomId": map[string]any{"type": "integer", "description": "教室 ID（与 q 二选一）"},
					"q":           map[string]any{"type": "string", "description": "关键字：教师姓名、课程名、教学班名或教室名（与 classroomId 二选一）"},
					"from":        map[string]any{"type": "string", "description": "起始日期，YYYY-MM-DD（含）"},
					"to":          map[string]any{"type": "string", "description": "结束日期，YYYY-MM-DD（含）"},
					"weekOf":      map[string]any{"type": "string", "description": "该周任意一天的日期，YYYY-MM-DD，查整周"},
					"date":        map[string]any{"type": "string", "description": "单日查询，YYYY-MM-DD"},
					"limit":       map[string]any{"type": "integer", "description": "最多返回多少节，可选（默认取上限）"},
				},
				"required": []string{},
			}),
		NewToolDef("propose_booking",
			"生成教室预约预览（不提交）。校验教室存在且可用、日期格式、节次区间在当日作息制度内、用途非空，并列出该时段该教室的冲突（课程或已提交的预约）。预览会展示给用户，用户点击确认后才真正提交预约。",
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"classroomId": map[string]any{"type": "integer", "description": "教室 ID"},
					"date":        map[string]any{"type": "string", "description": "日期，YYYY-MM-DD"},
					"periodStart": map[string]any{"type": "integer", "description": "起始节次"},
					"periodEnd":   map[string]any{"type": "integer", "description": "结束节次（含）"},
					"purpose":     map[string]any{"type": "string", "description": "预约用途，如“补课”"},
				},
				"required": []string{"classroomId", "date", "periodStart", "periodEnd", "purpose"},
			}),
	}
}

// runRounds drives the tool-call loop. The caller opens the first upstream
// stream itself (so it can answer transport failures with plain JSON before
// any SSE bytes are committed) and hands it here; subsequent rounds are
// opened by this loop. Errors returned are the ones the caller should
// surface as an `error` event.
func (a *Agent) runRounds(ctx context.Context, msgs []ChatMessage, roundCtx context.Context,
	roundCancel context.CancelFunc, first *Stream, emit func(string, any)) error {

	stream := first
	toolRounds := 0
	for {
		_, calls, err := a.consumeStream(roundCtx, stream, emit)
		stream.Close()
		roundCancel()
		if err != nil {
			return err
		}
		if len(calls) == 0 {
			emit("done", map[string]any{})
			return nil
		}
		toolRounds++
		if toolRounds >= maxRounds {
			return errors.New("AI 助手处理步骤过多，请简化问题后重试")
		}

		// Execute the tool calls, then hand the results back for the next round.
		msgs = append(msgs, ChatMessage{Role: "assistant", ToolCalls: calls})
		for _, call := range calls {
			result, proposal, err := a.executeTool(ctx, call, emit)
			if err != nil {
				return err
			}
			if proposal != nil {
				emit("proposal", map[string]any{
					"id":      newProposalID(),
					"action":  "create_booking",
					"payload": proposal,
				})
			}
			msgs = append(msgs, ChatMessage{
				Role:       "tool",
				ToolCallID: call.ID,
				Content:    result,
			})
		}

		roundCtx, roundCancel = context.WithTimeout(ctx, roundTimeout)
		stream, err = a.client.StreamRequest(roundCtx, msgs, a.Definitions())
		if err != nil {
			roundCancel()
			return err
		}
	}
}

// buildMessages assembles the system prompt and the client history. It loads
// the regime table for the prompt here; validSlot reuses the same snapshot so
// the model is never shown a regime the tools then reject. A regime load
// failure fails open (no block in the prompt): tool-free chat still works,
// and the tools query fresh when actually invoked.
func (a *Agent) buildMessages(ctx context.Context, history []Message) []ChatMessage {
	regimes, err := a.regimes.ListRegimes(ctx)
	if err != nil {
		logging.L.Error("ai load regimes for prompt", "err", err)
	} else {
		a.turnRegimes, a.turnRegimesLoaded = regimes, true
	}
	msgs := []ChatMessage{{Role: "system", Content: systemPrompt(time.Now(), regimes)}}
	for _, m := range history {
		msgs = append(msgs, ChatMessage{Role: m.Role, Content: m.Content})
	}
	return msgs
}

// regimesFor returns the turn's regime snapshot, falling back to a live query
// when the prompt-time load failed.
func (a *Agent) regimesFor(ctx context.Context) ([]schedule.Regime, error) {
	if a.turnRegimesLoaded {
		return a.turnRegimes, nil
	}
	return a.regimes.ListRegimes(ctx)
}

// consumeStream relays text deltas to the client and accumulates tool-call
// fragments by index until the upstream stream ends. It returns the assembled
// text (already emitted) and the tool calls sorted by index.
func (a *Agent) consumeStream(ctx context.Context, stream *Stream, emit func(string, any)) (string, []ChatToolCall, error) {
	type result struct {
		ch    streamChunk
		event bool
		err   error
	}
	pump := make(chan result, 8)
	go func() {
		defer close(pump)
		for {
			ch, event, err := stream.Next(ctx)
			if err != nil {
				pump <- result{err: err}
				return
			}
			pump <- result{ch: ch, event: event}
		}
	}()

	var text strings.Builder
	calls := map[int]*ChatToolCall{}
	idle := time.NewTimer(idleTimeout)
	defer idle.Stop()

	for {
		select {
		case <-idle.C:
			return "", nil, errors.New("AI 助手响应超时，请稍后再试")
		case <-ctx.Done():
			return "", nil, ctx.Err()
		case res, ok := <-pump:
			if !ok {
				return "", nil, errors.New("AI 助手响应异常结束")
			}
			idle.Reset(idleTimeout)
			if res.err != nil {
				if errors.Is(res.err, io.EOF) {
					return a.finishRound(text.String(), calls)
				}
				if ctx.Err() != nil {
					return "", nil, ctx.Err()
				}
				logging.L.Error("ai upstream stream", "err", res.err)
				return "", nil, ErrUpstreamUnavailable
			}
			if !res.event {
				continue // keep-alive traffic
			}
			ch := res.ch
			if ch.Error != nil {
				logging.L.Error("ai upstream error chunk", "message", ch.Error.Message)
				return "", nil, ErrUpstreamUnavailable
			}
			for _, choice := range ch.Choices {
				if choice.Delta.Content != "" {
					text.WriteString(choice.Delta.Content)
					emit("delta", map[string]any{"content": choice.Delta.Content})
				}
				for _, tc := range choice.Delta.ToolCalls {
					call, ok := calls[tc.Index]
					if !ok {
						call = &ChatToolCall{Index: tc.Index}
						calls[tc.Index] = call
					}
					if tc.ID != "" {
						call.ID = tc.ID
					}
					if tc.Type != "" {
						call.Type = tc.Type
					}
					if tc.Function.Name != "" {
						call.Function.Name = tc.Function.Name
					}
					call.Function.Arguments += tc.Function.Arguments
				}
			}
		}
	}
}

// finishRound flattens the accumulated tool calls into a stable order.
func (a *Agent) finishRound(text string, calls map[int]*ChatToolCall) (string, []ChatToolCall, error) {
	if len(calls) == 0 {
		return text, nil, nil
	}
	indexes := make([]int, 0, len(calls))
	for i := range calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	list := make([]ChatToolCall, 0, len(indexes))
	for _, i := range indexes {
		list = append(list, *calls[i])
	}
	return text, list, nil
}

// executeTool runs one tool call with permission gating. Business rejections
// (missing permission, invalid arguments) become tool results the LLM relays
// with status "error"; only infrastructure errors abort the turn.
func (a *Agent) executeTool(ctx context.Context, call ChatToolCall, emit func(string, any)) (string, *ProposalPayload, error) {
	if permission := a.permissionFor(call.Function.Name); permission != "" && !a.subject.Has(permission) {
		msg := fmt.Sprintf("当前用户没有执行 %s 所需的权限（%s），请告知用户向管理员申请该权限。",
			call.Function.Name, permission)
		emit("tool", map[string]any{"name": call.Function.Name, "status": "error", "result": msg})
		return msg, nil, nil
	}

	var rawArgs json.RawMessage
	if call.Function.Arguments != "" {
		rawArgs = json.RawMessage(call.Function.Arguments)
	}
	// Announce the call so the UI can show a "querying..." indicator.
	emit("tool", map[string]any{"name": call.Function.Name, "status": "running", "args": parseArgs(rawArgs)})

	result, ok, proposal, err := a.runTool(ctx, call.Function.Name, rawArgs)
	if err != nil {
		return "", nil, err
	}
	status := "ok"
	if !ok {
		status = "error"
	}
	// Clients render only the name/status tag, so the (up to 12 KB) success
	// payload is not worth pushing down the SSE stream; keep a short preview
	// for failures, which is where diagnosis actually needs it.
	payload := map[string]any{"name": call.Function.Name, "status": status}
	if !ok {
		payload["result"] = truncate(result, maxToolErrorPreview)
	}
	emit("tool", payload)
	return truncate(result, maxToolResultBytes), proposal, nil
}

// permissionFor maps a tool name to the permission its data requires.
func (a *Agent) permissionFor(name string) string {
	switch name {
	case "list_classrooms", "query_availability":
		return authz.ClassroomRead
	case "query_timetable":
		return authz.CourseRead
	case "propose_booking":
		return authz.ClassroomBook
	}
	return ""
}

// runTool dispatches to the concrete tool implementations. ok reports whether
// the tool produced a usable result; business rejections set ok=false and put
// the explanation in result.
func (a *Agent) runTool(ctx context.Context, name string, rawArgs json.RawMessage) (result string, ok bool, proposal *ProposalPayload, err error) {
	switch name {
	case "list_classrooms":
		return a.toolListClassrooms(ctx, rawArgs)
	case "query_availability":
		return a.toolQueryAvailability(ctx, rawArgs)
	case "query_timetable":
		return a.toolQueryTimetable(ctx, rawArgs)
	case "propose_booking":
		return a.toolProposeBooking(ctx, rawArgs)
	}
	return fmt.Sprintf("未知工具：%s", name), false, nil, nil
}

// --- tool implementations ---

// classroomBrief is the compact classroom shape handed to the LLM.
type classroomBrief struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Building string `json:"building"`
	Capacity int    `json:"capacity"`
	Type     string `json:"type"`
	Campus   string `json:"campus"`
	Floor    string `json:"floor"`
	Status   string `json:"status"`
}

func briefClassrooms(list []classroom.Classroom) []classroomBrief {
	out := make([]classroomBrief, 0, len(list))
	for _, c := range list {
		out = append(out, classroomBrief{
			ID: c.ID, Name: c.Name, Building: c.Building, Capacity: c.Capacity,
			Type: c.Type, Campus: c.Campus, Floor: c.Floor, Status: c.Status,
		})
	}
	return out
}

// availableBrief is the lean row shape for availability results. status is
// implied by the query, campus is school-wide, and floor/description are not
// needed to pick or book a room. Dropping them roughly halves the per-room
// cost, so the byte budget covers a whole campus in most deployments instead
// of truncating at the smallest ~25 rooms.
type availableBrief struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Building string `json:"building"`
	Capacity int    `json:"capacity"`
	Type     string `json:"type"`
}

func briefAvailable(list []classroom.Classroom) []availableBrief {
	out := make([]availableBrief, 0, len(list))
	for _, c := range list {
		out = append(out, availableBrief{
			ID: c.ID, Name: c.Name, Building: c.Building, Capacity: c.Capacity, Type: c.Type,
		})
	}
	return out
}

func (a *Agent) toolListClassrooms(ctx context.Context, raw json.RawMessage) (string, bool, *ProposalPayload, error) {
	var args struct {
		CapacityMin int    `json:"capacityMin"`
		Building    string `json:"building"`
		Q           string `json:"q"`
		Type        string `json:"type"`
		Limit       int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return "参数解析失败：" + err.Error(), false, nil, nil
	}
	list, total, err := a.classrooms.ListFiltered(ctx, classroom.ClassroomFilter{
		Q:           args.Q,
		Building:    args.Building,
		Type:        args.Type,
		CapacityMin: args.CapacityMin,
	}, clampLimit(args.Limit))
	if err != nil {
		return "", false, nil, fmt.Errorf("list classrooms: %w", err)
	}
	return marshalToolList(map[string]any{}, "classrooms", briefClassrooms(list), total, classroomListNote), true, nil, nil
}

func (a *Agent) toolQueryAvailability(ctx context.Context, raw json.RawMessage) (string, bool, *ProposalPayload, error) {
	var args struct {
		Date        string `json:"date"`
		PeriodStart int    `json:"periodStart"`
		PeriodEnd   int    `json:"periodEnd"`
		CapacityMin int    `json:"capacityMin"`
		Building    string `json:"building"`
		Type        string `json:"type"`
		Limit       int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return "参数解析失败：" + err.Error(), false, nil, nil
	}
	regime, msg, ok := a.validSlot(ctx, args.Date, args.PeriodStart, args.PeriodEnd)
	if !ok {
		return msg, false, nil, nil
	}
	list, total, err := a.classrooms.ListAvailable(ctx, classroom.AvailableFilter{
		Date:        args.Date,
		PeriodStart: args.PeriodStart,
		PeriodEnd:   args.PeriodEnd,
		CapacityMin: args.CapacityMin,
		Building:    strings.TrimSpace(args.Building),
		Type:        args.Type,
	}, clampLimit(args.Limit))
	if err != nil {
		return "", false, nil, fmt.Errorf("list available classrooms: %w", err)
	}
	out := map[string]any{
		"date":       args.Date,
		"regimeName": regime.Name,
		"periods":    periodRange(regime, args.PeriodStart, args.PeriodEnd),
	}
	return marshalToolList(out, "classrooms", briefAvailable(list), total, availableNote), true, nil, nil
}

type timetableArgs struct {
	ClassroomID int64  `json:"classroomId"`
	Q           string `json:"q"`
	From        string `json:"from"`
	To          string `json:"to"`
	WeekOf      string `json:"weekOf"`
	Date        string `json:"date"`
	Limit       int    `json:"limit"`
}

func (a *Agent) toolQueryTimetable(ctx context.Context, raw json.RawMessage) (string, bool, *ProposalPayload, error) {
	var args timetableArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return "参数解析失败：" + err.Error(), false, nil, nil
	}
	if args.ClassroomID <= 0 && strings.TrimSpace(args.Q) == "" {
		return "请提供教室 ID 或关键字（教师/课程/教学班/教室名）之一。", false, nil, nil
	}
	from, to, msg := normalizeRange(args)
	if msg != "" {
		return msg, false, nil, nil
	}

	// Both branches page through the same query so a classroom's whole term
	// cannot arrive unbounded (the old ListSessions path had no SQL limit) and
	// so the result carries an exact total for the truncation note.
	filter := course.SessionFilter{From: from, To: to, Q: strings.TrimSpace(args.Q)}
	if args.ClassroomID > 0 {
		filter.ClassroomID = args.ClassroomID
		filter.Q = ""
	}
	rows, total, err := a.courses.PageSessions(ctx, filter, dbutil.Pagination{Limit: clampLimit(args.Limit)})
	if err != nil {
		return "", false, nil, fmt.Errorf("list timetable sessions: %w", err)
	}

	type slot struct {
		Date              string `json:"date"`
		DayOfWeek         int    `json:"dayOfWeek"`
		PeriodStart       int    `json:"periodStart"`
		PeriodEnd         int    `json:"periodEnd"`
		CourseName        string `json:"courseName"`
		Teacher           string `json:"teacher"`
		TeachingClassName string `json:"teachingClassName"`
		ClassroomName     string `json:"classroomName"`
	}
	slots := make([]slot, 0, len(rows))
	for _, v := range rows {
		slots = append(slots, slot{
			Date: v.Date, DayOfWeek: dayOfWeek(v.Date), PeriodStart: v.PeriodStart, PeriodEnd: v.PeriodEnd,
			CourseName: v.CourseName, Teacher: v.Teacher, TeachingClassName: v.TeachingClassName,
			ClassroomName: v.ClassroomName,
		})
	}
	return marshalToolList(map[string]any{"from": from, "to": to}, "sessions", slots, int(total), timetableNote), true, nil, nil
}

func (a *Agent) toolProposeBooking(ctx context.Context, raw json.RawMessage) (string, bool, *ProposalPayload, error) {
	var args struct {
		ClassroomID int64  `json:"classroomId"`
		Date        string `json:"date"`
		PeriodStart int    `json:"periodStart"`
		PeriodEnd   int    `json:"periodEnd"`
		Purpose     string `json:"purpose"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return "参数解析失败：" + err.Error(), false, nil, nil
	}
	if strings.TrimSpace(args.Purpose) == "" {
		return "请提供预约用途。", false, nil, nil
	}
	regime, msg, ok := a.validSlot(ctx, args.Date, args.PeriodStart, args.PeriodEnd)
	if !ok {
		return msg, false, nil, nil
	}
	cr, err := a.classrooms.GetByID(ctx, args.ClassroomID)
	if errors.Is(err, classroom.ErrNotFound) {
		return "教室不存在，请重新查询教室列表。", false, nil, nil
	}
	if err != nil {
		return "", false, nil, fmt.Errorf("load classroom: %w", err)
	}
	if cr.Status != classroom.StatusAvailable {
		return "该教室当前不可预约（非可用状态）。", false, nil, nil
	}
	conflicts, err := a.bookings.ConflictsDetail(ctx, args.ClassroomID, args.Date, args.PeriodStart, args.PeriodEnd)
	if err != nil {
		return "", false, nil, fmt.Errorf("load conflicts: %w", err)
	}
	payload := &ProposalPayload{
		ClassroomID:   cr.ID,
		ClassroomName: cr.Name,
		Date:          args.Date,
		PeriodStart:   args.PeriodStart,
		PeriodEnd:     args.PeriodEnd,
		PeriodLabel:   periodLabel(regime, args.PeriodStart, args.PeriodEnd),
		Purpose:       strings.TrimSpace(args.Purpose),
		Conflicts:     conflicts,
	}
	if len(conflicts) > 0 {
		return fmt.Sprintf("预约预览已生成并发送给用户，但该时段存在 %d 项冲突，请提醒用户查看预览中的冲突明细，确认提交可能失败。", len(conflicts)),
			true, payload, nil
	}
	return fmt.Sprintf("预约预览已生成并发送给用户，等待用户确认。教室：%s，%s 第%d-%d节。",
		cr.Name, args.Date, args.PeriodStart, args.PeriodEnd), true, payload, nil
}

// --- shared helpers ---

// validSlot checks the date format, that an active regime exists for the date
// and that every period in the range is a real period of it — the same rule
// booking.validateBooking enforces on real submissions.
func (a *Agent) validSlot(ctx context.Context, date string, ps, pe int) (schedule.Regime, string, bool) {
	if ps < 1 || pe < 1 {
		return schedule.Regime{}, "节次必须大于等于 1。", false
	}
	if ps > pe {
		return schedule.Regime{}, "起始节次不能晚于结束节次。", false
	}
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return schedule.Regime{}, "日期格式错误，请使用 YYYY-MM-DD。", false
	}
	regimes, err := a.regimesFor(ctx)
	if err != nil {
		return schedule.Regime{}, "", false
	}
	regime, ok := schedule.ActiveFor(regimes, t)
	if !ok {
		return schedule.Regime{}, "该日期没有生效的作息制度，无法校验节次。", false
	}
	valid := schedule.PeriodIndexSet(regime)
	for i := ps; i <= pe; i++ {
		if !valid[i] {
			return schedule.Regime{}, fmt.Sprintf("节次 %d 不在该日期生效的作息制度（%s）内，请根据作息调整节次。", i, regime.Name), false
		}
	}
	return regime, "", true
}

// periodRange lists the regime periods in [ps, pe] for the tool result.
func periodRange(r schedule.Regime, ps, pe int) []map[string]any {
	var out []map[string]any
	for _, p := range r.Periods {
		if p.PeriodIndex >= ps && p.PeriodIndex <= pe {
			out = append(out, map[string]any{"index": p.PeriodIndex, "startTime": p.StartTime, "endTime": p.EndTime})
		}
	}
	return out
}

// periodLabel renders 第5-7节（14:00-17:00） from the active regime.
func periodLabel(r schedule.Regime, ps, pe int) string {
	var startTime, endTime string
	for _, p := range r.Periods {
		if p.PeriodIndex == ps {
			startTime = p.StartTime
		}
		if p.PeriodIndex == pe {
			endTime = p.EndTime
		}
	}
	label := fmt.Sprintf("第%d节", ps)
	if ps != pe {
		label = fmt.Sprintf("第%d-%d节", ps, pe)
	}
	if startTime != "" && endTime != "" {
		label += fmt.Sprintf("（%s-%s）", startTime, endTime)
	}
	return label
}

// normalizeRange turns the timetable tool's date inputs into a from/to pair.
func normalizeRange(args timetableArgs) (from, to, msg string) {
	parse := func(s string) (time.Time, bool) {
		t, err := time.Parse("2006-01-02", s)
		return t, err == nil
	}
	switch {
	case args.Date != "":
		t, ok := parse(args.Date)
		if !ok {
			return "", "", "日期格式错误，请使用 YYYY-MM-DD。"
		}
		d := t.Format("2006-01-02")
		return d, d, ""
	case args.WeekOf != "":
		t, ok := parse(args.WeekOf)
		if !ok {
			return "", "", "日期格式错误，请使用 YYYY-MM-DD。"
		}
		// Shift back to the Monday of the week (Mon=1 .. Sun=7).
		offset := (int(t.Weekday()) + 6) % 7
		monday := t.AddDate(0, 0, -offset)
		return monday.Format("2006-01-02"), monday.AddDate(0, 0, 6).Format("2006-01-02"), ""
	case args.From != "" || args.To != "":
		if args.From != "" {
			if _, ok := parse(args.From); !ok {
				return "", "", "起始日期格式错误，请使用 YYYY-MM-DD。"
			}
		}
		if args.To != "" {
			if _, ok := parse(args.To); !ok {
				return "", "", "结束日期格式错误，请使用 YYYY-MM-DD。"
			}
		}
		return args.From, args.To, ""
	default:
		return "", "", "请提供日期范围（from/to、weekOf 或 date 之一）。"
	}
}

func dayOfWeek(date string) int {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0
	}
	d := int(t.Weekday()) // Sun=0..Sat=6
	if d == 0 {
		d = 7
	}
	return d
}

// marshalToolResult serializes a tool result compactly for the LLM.
func marshalToolResult(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("结果序列化失败：%v", err)
	}
	return string(b)
}

func parseArgs(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return v
}

// truncate caps a plain-text tool result at a UTF-8 boundary. Structured
// results do not rely on it (marshalToolList keeps them valid by construction),
// so this is the backstop for business rejections and stray serialization
// text: cutting mid-rune would hand the model a broken character.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…(已截断)"
}

// clampLimit bounds the row count a tool asks the store for. Zero means "give
// me the default upper bound"; anything above it is clamped, never rejected —
// the model cannot know the cap, and an error would cost a whole tool round.
func clampLimit(v int) int {
	if v <= 0 || v > maxToolListItems {
		return maxToolListItems
	}
	return v
}

// marshalToolList renders env plus a list under a byte budget. Rows are kept or
// dropped whole — never sliced — so the output is always valid JSON, and
// total/shown let the model say "137 matched, here are 80" instead of
// presenting a truncated list as complete.
//
// Truncation samples both ends (smallest and largest rooms, earliest and
// latest sessions) because a capacity-ascending prefix alone would tell the
// model that large rooms do not exist. Paging is deliberately not offered: a
// tool round plus the result staying in the transcript for every later round
// makes it the most expensive way to see more, and the user wants an answer,
// not 500 rows.
func marshalToolList[T any](env map[string]any, key string, items []T, total int, noteFmt string) string {
	return marshalToolListBudget(env, key, items, total, noteFmt, maxToolResultBytes)
}

// marshalToolListBudget is marshalToolList with an injectable budget so tests
// can exercise the truncation path without building 12 KB of fixtures.
func marshalToolListBudget[T any](env map[string]any, key string, items []T, total int, noteFmt string, budget int) string {
	sizes := make([]int, len(items))
	for i, it := range items {
		b, err := json.Marshal(it)
		if err != nil {
			continue
		}
		sizes[i] = len(b)
	}
	// The envelope is measured before the list is attached: its keys, the
	// periods array and the like are all fixed costs of this result.
	remaining := budget - len(marshalToolResult(env)) - envelopeReserve
	kept := items
	if listBytes(sizes) > remaining {
		kept = sampleBothEnds(items, sizes, remaining)
	}

	env[key] = kept
	env["total"] = total
	env["shown"] = len(kept)
	if len(kept) < total {
		env["truncated"] = true
		env["note"] = fmt.Sprintf(noteFmt, total, len(kept))
	}
	return marshalToolResult(env)
}

// sampleBothEnds takes rows from the head until half the budget is spent, then
// from the tail with what is left. At least one row survives: an empty list
// reads as "nothing found", which is a worse lie than an incomplete one.
func sampleBothEnds[T any](items []T, sizes []int, budget int) []T {
	if len(items) == 0 {
		return items
	}
	if budget <= 0 {
		return items[:1]
	}
	half := budget / 2
	head, usedHead := 0, 0
	for head < len(items) && usedHead+sizes[head]+1 <= half {
		usedHead += sizes[head] + 1
		head++
	}
	if head == 0 {
		return items[:1]
	}
	tail, usedTail := len(items), 0
	for tail > head && usedTail+sizes[tail-1]+1 <= budget-usedHead {
		usedTail += sizes[tail-1] + 1
		tail--
	}
	out := make([]T, 0, head+len(items)-tail)
	out = append(out, items[:head]...)
	out = append(out, items[tail:]...)
	return out
}

// listBytes is the serialized size of the rows plus their separating commas.
func listBytes(sizes []int) int {
	n := 0
	for _, s := range sizes {
		n += s + 1
	}
	return n
}

// newProposalID returns a random 8-byte hex id for a proposal event.
func newProposalID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
