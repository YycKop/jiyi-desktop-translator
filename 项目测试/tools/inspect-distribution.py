#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查便携版 userdata 里有哪些“不能直接分享”的内容。"""
import json
import os

ROOT = r"D:\桌面翻译助手\dist\win-x64"
UD = os.path.join(ROOT, "userdata")
CFG = os.path.join(UD, "config.json")


def size_of(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for base, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


print("userdata entries:")
for name in sorted(os.listdir(UD)):
    p = os.path.join(UD, name)
    print("  %-28s %10.1f MB  %s" % (name, size_of(p) / 1048576, "dir" if os.path.isdir(p) else "file"))

cfg = json.load(open(CFG, encoding="utf-8"))
print("\nconfig top-level keys:", sorted(cfg))
print("onboarded:", cfg.get("onboarded"))
print("offline:", json.dumps(cfg.get("offline"), ensure_ascii=False))
print("capture.lastSelection:", cfg.get("capture", {}).get("lastSelection"))
print("hud.fixedPoint:", cfg.get("hud", {}).get("fixedPoint"), "ballPoint:", cfg.get("hud", {}).get("ballPoint"))
print("hud.position:", cfg.get("hud", {}).get("position"))
print("general.targetLang:", cfg.get("general", {}).get("targetLang"))
print("hotkeys:", json.dumps(cfg.get("hotkeys"), ensure_ascii=False))
apis = cfg.get("apis", [])
print("apis count:", len(apis))
for a in apis:
    print("  - id=%s name=%s baseUrl=%s model=%s enabled=%s order=%s"
          % (a.get("id"), a.get("name"), a.get("baseUrl"), a.get("model"), a.get("enabled"), a.get("order")))
sec = cfg.get("secrets", {})
items = (sec or {}).get("items", {})
print("secrets.items keys:", list(items.keys()), "salt present:", bool((sec or {}).get("salt")))

for probe in ("bridge.json", "safe-mode.flag", "startup-error.log", "core.log", "launcher.log"):
    p = os.path.join(UD, probe)
    print("%-20s exists=%s size=%s" % (probe, os.path.exists(p), os.path.getsize(p) if os.path.exists(p) else "-"))

logs = os.path.join(UD, "logs")
if os.path.isdir(logs):
    for f in os.listdir(logs):
        print("  log:", f, os.path.getsize(os.path.join(logs, f)))
