#!/usr/bin/env python3
"""校验小程序顶部导航约定（改页面后跑一次，CI 里也会跑）。

约定：
1. 每个页面 wxml 必须有 `<app-navbar>`，否则 custom 导航下页面会没有标题、内容顶到状态栏；
2. `<app-navbar title="X">` 的字面量标题必须与 page.json 的 `navigationBarTitleText` 一致
   （json 里的标题现在只在文档/回退时使用，容易和模板漂移，这里把它锁住）；
   动态标题（`title="{{...}}"`）跳过比对。

用法：python3 miniapp/scripts/check-navbar.py [小程序目录]
      （默认取脚本所在目录的父级，因此从任意 cwd 调用都能工作）
退出码：0 通过，1 有问题。
"""
import json
import pathlib
import re
import sys

# 脚本位于 miniapp/scripts/ 下，默认检查它所在的小程序项目，不依赖 cwd
DEFAULT_MINIAPP_DIR = pathlib.Path(__file__).resolve().parents[1]
miniapp_dir = (
    pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_MINIAPP_DIR
)
pages_dir = miniapp_dir / "pages"
if not pages_dir.is_dir():
    print(f"找不到小程序页面目录: {pages_dir}")
    sys.exit(1)

problems = []
checked = 0

# 允许「导航栏存在但无标题」的页面：登录页是品牌引导页，标题由页面内的大标题承担
ALLOW_EMPTY_TITLE = {"login"}

for page_dir in sorted(p for p in pages_dir.iterdir() if p.is_dir()):
    name = page_dir.name
    wxml = page_dir / f"{name}.wxml"
    conf = page_dir / f"{name}.json"
    checked += 1
    if not wxml.exists() or not conf.exists():
        problems.append(f"{name}: 缺少 {name}.wxml 或 {name}.json")
        continue

    src = wxml.read_text(encoding="utf-8")
    if "<app-navbar" not in src:
        problems.append(f"{name}: 缺少 <app-navbar>")
        continue

    tag = re.search(r"<app-navbar\b[^>]*>", src)
    if not tag:
        problems.append(f"{name}: <app-navbar> 标签未闭合或写法异常")
        continue

    title_attr = re.search(r'\btitle="([^"]*)"', tag.group(0))
    if not title_attr:
        problems.append(f"{name}: <app-navbar> 缺少 title 属性")
        continue

    literal = title_attr.group(1)
    if "{{" in literal:
        continue  # 动态标题，交给页面逻辑

    expected = json.loads(conf.read_text(encoding="utf-8")).get("navigationBarTitleText", "")
    if literal == "" and name in ALLOW_EMPTY_TITLE:
        continue
    if literal != expected:
        problems.append(f"{name}: 标题不一致 wxml=「{literal}」 json=「{expected}」")

print(f"检查页面 {checked} 个，问题 {len(problems)} 个")
for p in problems:
    print("  -", p)
sys.exit(1 if problems else 0)
