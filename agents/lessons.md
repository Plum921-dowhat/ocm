# 实战教训（lessons）

> 每条对应一个根因，按「现象 → 根因 → 规则」记录。过时即删，项目经验保留。

## 错误吞噬与计数

- **「失败 N 条却无错误明细」的假象**：importer commit 阶段曾有错误被
  append 到局部 `errs` 而非 `res.Errors`，界面只见失败数不见原因。规则：
  结果聚合只经 `Result.Errors` 一个出口，不应存在局部结果切片。
- **成功计数不要用 `len(clean)`**：被跳过或预检失败的行会被计入成功数。
  规则：使用显式计数器，仅在写库成功后递增。
- **任何 `rows` 循环必须检查 `rows.Err()`**——漏检时数据库中途断连表现为
  「静默少数据」，而非报错。

## 数据库与并发

- **「缺字段导致下游报错」必须检查 Go Scan 层**：课程库 code 曾经历可空
  阶段，8 处 `Scan` 将 NULL 扫描进 `string`，导致相关查询全部报错。规则：
  建模型时须将 nullable 与 Scan 目标类型逐一对表，不应仅检查 SQL。
- **check-then-write 必须做 TOCTOU 加固**：成员冻结检查在事务外查询、事务内
  写入会产生竞态。规则：事务内 `SELECT ... FOR UPDATE` 重新校验（REPEATABLE
  READ 下 `COUNT(*) ... FOR UPDATE` 以间隙锁封锁插入）。
- **IN 列表分批**（约 1000 元组/批）：冲突预查使用全量 IN 时，大文件会超出
  数据包体积上限；sessions/bookings 的冲突查询均已分批，新增批量查询应沿用
  该做法。
- **幂等迁移**：`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` +
  `ON CONFLICT DO NOTHING`；唯一冲突判断收敛在 `dbutil`（`IsDuplicateEntry`
  / `DuplicateKeyName`），依据 **SQLSTATE 23505 + 约束名**结构化取用，不应
  解析错误消息字符串（措辞变更后即静默退化）。`ON CONFLICT (col)` 的目标列上
  必须确实存在唯一约束，否则属运行期报错而非编译期报错。

## PostgreSQL（2026-10 自 MySQL 迁移）

- **`?` → `$n` 不能仅按字面量机械替换**：逐条件 `where += ` AND x = ?`` 的
  动态片段，若每个片段都从 `$1` 重新计数，会与已有占位符编号冲突。规则：
  动态拼接一律走 `dbutil.Bind(&args, v)`（追加参数并返回占位符，编号由参数
  表长度导出），IN 列表走 `dbutil.Placeholders(start, n)`。
- **naive `timestamp` 是陷阱，应禁用**：pgx 编码取 `time.Time` 的墙钟字段、
  解码附加 `UTC` 标签，两端标签均为错误——`Equal/Before/Unix/JSON` 静默错 8
  小时且**不报错**，比 MySQL DATETIME（至少错误表现直观）更隐蔽；且写入
  `time.Now()` 的库内容会变成**部署时区的函数**。瞬时列一律使用
  `timestamptz`，取墙钟用 `AT TIME ZONE`。
- **PG 的 `LIKE` 大小写敏感**：MySQL utf8mb4 默认不敏感，迁移时漏改会导致
  「搜索突然查不到」且无任何报错。用户输入搜索一律使用 `ILIKE`。
- **墙钟单一写入方**：SQL `now()` 只用于只读比较，**不得**用于写入时间列；
  混用会使库内出现两种来源的墙钟（旧 MySQL 时代以 `NOW()` 写入的列正是
  「混合墙钟」的唯一来源）。`ON UPDATE CURRENT_TIMESTAMP` 无对应物，需补在
  UPDATE 语句中。
- **pgx 未识别 URL 参数时按原名下发运行时参数，且大小写敏感**：`TimeZone=…`
  （libpq 写法）会被静默忽略，必须写 GUC 真名 `timezone`。规则：此类「配置
  是否真正生效」的假设一律配一条集成测试（`TestSessionAnchorTookEffect` 即
  用于拦截该问题），不应仅依据文档推断。
- **同一 `$n` 不可复用于类型不同的两列**：会报 `inconsistent types deduced for
  parameter`；MySQL 会静默强转，迁移时这类语句须拆分参数。
- **`sqlx.Rebind` 是纯文本替换、不识别引号**：字符串字面量中的 `?`、jsonb 的
  `?`/`?|`/`?&` 操作符都会被改坏。本项目因此保留裸 `$n`、不引入 sqlx。
- **`FOR UPDATE` 不能配聚合函数，且 PG 没有 gap lock**：迁移时若把 MySQL 的
  `SELECT COUNT(*) … FOR UPDATE`（依靠 InnoDB gap lock 阻止并发插入）原样
  保留，PG 会直接报 `FOR UPDATE is not allowed with aggregate functions`——
  教学班 update/delete 整条路由返回 500（由代码评审发现）。跨模块「父行锁」
  才是正确形态：写方（Create/UpdateOffering）与检查方（Update/DeleteTeachingClass）
  都在各自事务中执行 `SELECT … FROM 父表 WHERE id = $1 FOR UPDATE`，以同一把
  行锁串行化检查与写入；计数本身保持普通 SELECT。
- **索引名是 schema 级命名空间（跨表唯一）**：`idx_user`/`idx_status` 这类
  泛化名在 MySQL 中为表级、在 PG 中为全局——后建的同名索引会被
  `CREATE INDEX IF NOT EXISTS` **静默跳过**（零报错，索引自此不存在；
  2026-10 实测 import_jobs 两枚、observations 一枚缺失）。一律命名为
  `idx_<表名>_<用途>`；由 CI 重名检查门禁保障。

## 契约语义（不应作为缺陷修复）

- **教务处主课表「一课一周多行」是设计行为**：同一课程一周多节各占一行，
  不是重复数据（已核实真实数据分布）。
- **课程库 `code` 是身份键**：`name` 可重名（同名不同码属合法形态），一切
  upsert/引用按 code；文件内重码拒绝（防止 last-wins 静默覆盖）。
- **jwc 拆分后必须按依赖顺序确认**（教室→课程库→行政班→教学班→开课→
  课次）：预览期的「不存在」是信息性提示，不是失败。

## 依赖行为变化

- **Mosquitto 2.x 与 2.0 行为差异**：`auth-init.sh` 曾遇到两个问题——2.1 的
  secure `fopen 'w'` 等价于 O_EXCL，`-c` 遇已存在文件返回 EEXIST；2.1 只
  chown data 目录、不再整树兜底（pwfile 权限需预先备好）。升级 broker 前应
  阅读 `deploy/mosquitto/README.md`。
- **promtail 已 EOL（2026-03）**：日志采集使用 Grafana Alloy，不应再引入
  promtail 配置。
- **swag 定义名会随依赖图漂移（pgx → stdlib `os/user` 重名）**：`--parseDependency`
  解析整个 go-list 依赖树，其中包含 stdlib `os/user`——其包名即为 `user` 且含
  `User` 类型，与 `internal/user.User` 在 swag 全局同名去重表中相撞，双方被改名，
  本项目定义变成 `ocm-backend_internal_user.User`（swagger 漂移门禁失败，2026-10
  迁移 pgx 后首次暴露）。本项目注解只引用内部包类型，生成命令**一律不带**
  `--parseDependency`（`--parseInternal` 一并去掉：两者只作用于依赖树 walk，去掉后
  产物逐字节一致）。不应采用 `--useStructName`（全局去包名前缀，契约大改）或
  `// @name` 注释（对非分组 type 声明不生效）规避。

## 环境（国内开发机）

- `GOPROXY=https://goproxy.cn,direct`（默认代理源不通）；Docker Hub 不通，
  镜像 tag 须经网络检索核实后到服务器拉取验证。
- **httptest 死锁**：handler 中等待 `r.Context().Done()`，测试中调用
  `ts.Close()`（等待 handler 返回），两者相互等待。应使用显式 release channel，
  不应将请求取消作为信号。
- shell 多层引号传递中文 WHERE 条件会静默返回零行——中文条件进入 SQL 应使用
  文件或参数化，不应拼接命令行。
- **批量盘点时不要在并行命令中写入 `cd`**：一条命令中
  `cd X && rg PATTERN <相对路径>` 与另一条并行执行时，工作目录不保证按预期
  生效，grep 可能在错误的目录下执行并**返回空结果**，形似「零命中」。空结果
  尤其需要复核（漏报比误报风险更高）；跨目录盘点应使用绝对路径，或让每条
  命令自行携带 `cd`。
