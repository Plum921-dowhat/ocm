# 实战教训（lessons）

> 每条一个根因，写「现象 → 根因 → 规则」。过时即删，项目经验保留。

## 错误吞噬与计数

- **「失败 N 条却无错误明细」的幻影**：importer commit 阶段曾有错误被
  append 到局部 `errs` 而非 `res.Errors`，UI 只见失败数不见原因。规则：
  结果聚合只用 `Result.Errors` 一个出口，局部切片不许存在。
- **成功计数不要用 `len(clean)`**：被跳过/预检失败的行会混进成功数。
  规则：显式计数器，只在写库成功后递增。
- **任何 `rows` 循环必查 `rows.Err()`**——漏查时数据库中途断连表现为
  「静默少数据」，不是报错。

## 数据库与并发

- **「缺字段炸下游」必查 Go Scan 层**：课程库 code 曾经历可空阶段，
  8 处 `Scan` 把 NULL 扫进 `string` 直接全线报错。规则：建模型时 nullable
  与 Scan 目标类型逐一对表，别只看 SQL。
- **check-then-write 必须 TOCTOU 加固**：成员冻结检查在事务外查、事务内
  写会竞态。规则：事务内 `SELECT ... FOR UPDATE` 重校验（REPEATABLE READ
  下 `COUNT(*) ... FOR UPDATE` 用间隙锁封住插入）。
- **IN 列表分批**（约 1000 元组/批）：冲突预查全量 IN 在大文件下会撞包
  上限；sessions/bookings 的冲突查询均已分批，新写批量查询照抄。
- **幂等迁移**：`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` +
  `ON CONFLICT DO NOTHING`；唯一冲突判断收敛在 `dbutil`（`IsDuplicateEntry`
  / `DuplicateKeyName`），靠 **SQLSTATE 23505 + 约束名**结构化取用，不要解析
  错误消息字符串（措辞一改就静默退化）。`ON CONFLICT (col)` 目标列上必须真有
  唯一约束，否则是运行期报错而非编译期。

## PostgreSQL（2026-10 自 MySQL 迁移）

- **`?` → `$n` 不能只按字面量机械替换**：逐条件 `where += ` AND x = ?`` 的
  动态片段，每个片段都从 `$1` 重新数起会撞号。规则：动态拼接一律走
  `dbutil.Bind(&args, v)`（追加参数并返回占位符，编号由参数表长度导出），
  IN 列表走 `dbutil.Placeholders(start, n)`。
- **naive `timestamp` 是陷阱，禁用**：pgx 编码取 `time.Time` 的墙钟字段、
  解码挂 `UTC` 标签，两端标签都是假的——`Equal/Before/Unix/JSON` 静默错 8 小时
  且**不报错**，比 MySQL DATETIME（至少错得直观）更隐蔽；且写 `time.Now()`
  的库内容会变成**部署时区的函数**。瞬时列一律 `timestamptz`，取墙钟用
  `AT TIME ZONE`。
- **PG 的 `LIKE` 大小写敏感**：MySQL utf8mb4 默认不敏感，迁移时漏改会
  「搜索突然查不到」且无任何报错。用户输入搜索一律 `ILIKE`。
- **墙钟单一写入方**：SQL `now()` 只用于只读比较，**不得**用于写时间列；
  混用会让库内出现两种来源的墙钟（旧 MySQL 时代的 `NOW()` 写入列正是
  「混合墙钟」唯一来源）。`ON UPDATE CURRENT_TIMESTAMP` 无对应物，补在
  UPDATE 语句里。
- **pgx 未识别 URL 参数按原名下发运行时参数，大小写敏感**：`TimeZone=…`
  （libpq 写法）被静默忽略，必须写 GUC 真名 `timezone`。规则：这类"配置是否
  真生效"的假设一律配一条集成测试（`TestSessionAnchorTookEffect` 就是拦下它的
  钩子），别靠文档推断。
- **同一 `$n` 不可复用于类型不同的两列**：报 `inconsistent types deduced for
  parameter`；MySQL 会静默强转，迁移时这类语句要拆参数。
- **`sqlx.Rebind` 是纯文本替换、不识别引号**：  字符串字面量里的 `?`、jsonb 的
  `?`/`?|`/`?&` 操作符都会被改坏。本项目因此保留裸 `$n`、不引 sqlx。
- **`FOR UPDATE` 不能配聚合函数，且 PG 没有 gap lock**：迁移时把 MySQL 的
  `SELECT COUNT(*) … FOR UPDATE`（靠 InnoDB gap lock 挡并发插入）原样保留，
  PG 直接报 `FOR UPDATE is not allowed with aggregate functions`——教学班
  update/delete 整条路由 500（codex review 抓到）。跨模块「父行锁」才是正确
  形态：写方（Create/UpdateOffering）与检查方（Update/DeleteTeachingClass）
  都在各自事务里 `SELECT … FROM 父表 WHERE id = $1 FOR UPDATE`，同一把行锁
  串行化检查-写入；计数本身保持普通 SELECT。
- **索引名是 schema 级命名空间（跨表唯一）**：`idx_user`/`idx_status` 这类
  泛化名在 MySQL 是表级、在 PG 全局——后建的同名索引会被
  `CREATE INDEX IF NOT EXISTS` **静默跳过**（零报错，索引从此不存在；
  2026-10 实测 import_jobs 两枚、observations 一枚缺失）。一律
  `idx_<表名>_<用途>` 具名；CI 有重名检查门禁兜底。

## 契约语义（勿当 bug 修）

- **教务处主课表「一课一周多行」是设计行为**：同一课程一周多节各占一行，
  不是重复数据（真实库分布核实过）。
- **课程库 `code` 是身份键**：`name` 可重名（同名不同码合法），一切
  upsert/引用按 code；文件内重码拒绝（防 last-wins 静默覆盖）。
- **jwc 拆分后必须按依赖顺序确认**（教室→课程库→行政班→教学班→开课→
  课次）：预览期的「不存在」是信息性提示，不是失败。

## 依赖行为变化

- **Mosquitto 2.x 与 2.0 行为差异**：`auth-init.sh` 曾踩两坑——2.1 的
  secure `fopen 'w'` 等价 O_EXCL，`-c` 遇已存在文件 EEXIST；2.1 只 chown
  data 目录、不再整树兜底（pwfile 权限要先备好）。升级 broker 前读
  `deploy/mosquitto/README.md`。
- **promtail 已 EOL（2026-03）**：日志采集用 Grafana Alloy，别再引入
  promtail 配置。
- **swag 定义名会随依赖图漂移（pgx → stdlib `os/user` 撞名）**：`--parseDependency`
  解析整个 go-list 依赖树，其中包括 stdlib `os/user`——它的包名就是 `user` 且含
  `User` 类型，与 `internal/user.User` 在 swag 全局同名去重表相撞，双方被改名，我们的
  定义变成 `ocm-backend_internal_user.User`（swagger 漂移门禁红，2026-10 迁移 pgx 后
  首次暴露）。本项目注解只引用内部包类型，生成命令**一律不带 `--parseDependency`**
  （`--parseInternal` 一并去掉：两者只作用于依赖树 walk，去掉后产物逐字节一致）。别用
  `--useStructName`（全局去包名前缀，契约大改）或 `// @name` 注释（对非分组 type 声明
  不生效）绕。

## 环境（国内开发机）

- `GOPROXY=https://goproxy.cn,direct`（默认代理源不通）；Docker Hub 不通，
  镜像 tag 用网络检索核实后到服务器 pull 验证。
- **httptest 死锁**：handler 里等 `r.Context().Done()` + 测试里
  `ts.Close()`（等 handler 返回）= 互相等死。用显式 release channel，
  别用请求取消当信号。
- shell 多层引号传中文 WHERE 会静默零行——中文条件进 SQL 用文件或参数化，
  别拼命令行。
- **批量盘点别把 `cd` 写在并行命令里**：一条命令里 `cd X && rg PATTERN <相对路径>`
  与另一条并行执行时，工作目录不保证按预期生效，grep 会跑在错目录、**返回空**
  看起来像"零命中"。空结果尤其要复核（漏报比误报危险），跨目录盘点用绝对路径
  或每条命令自带 `cd`。
