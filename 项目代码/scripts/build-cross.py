#!/usr/bin/env python3
"""交叉打包器：在 Windows 上产出 macOS / Linux 免安装包（build-cross.py）

为什么不用 electron-builder：它会引入新依赖（CMD-02 需要审批），而且 macOS 目标仍然要在
macOS 上做签名/公证才完整。这里的做法是「官方 Electron 运行时 + 我们的 app 目录」手工组装，
产出可运行的目录结构；产物未签名，首次打开需要用户手动放行（包内说明里写了）。

用法（在 项目代码 目录下）：
  python scripts/build-cross.py --target mac-arm64
  python scripts/build-cross.py --target mac-x64
  python scripts/build-cross.py --target linux-x64
  python scripts/build-cross.py --target all

产物：dist/release/<即译-<版本>-<平台>-<架构>.(zip|tar.gz)
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys
import tarfile
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目代码
WS = os.path.dirname(ROOT)  # 工作区
CACHE = os.path.join(WS, "tmp", "electron-cache")
STAGE = os.path.join(WS, "dist", "cross")
OUT = os.path.join(WS, "dist", "release")
MIRROR = "https://registry.npmmirror.com/-/binary/electron/{ver}/electron-v{ver}-{name}.zip"

TARGETS = {
    "mac-x64": {"os": "macos", "plat": "darwin", "arch": "x64", "electron": "darwin-x64"},
    "mac-arm64": {"os": "macos", "plat": "darwin", "arch": "arm64", "electron": "darwin-arm64"},
    "linux-x64": {"os": "linux", "plat": "linux", "arch": "x64", "electron": "linux-x64"},
}

PAYLOAD_DIRS = ["src", "assets", "licenses"]
PAYLOAD_FILES = ["NOTICE.txt", "package.json"]


def log(msg):
    print(f"[cross] {msg}", flush=True)


# ----------------------------------------------------------------- 下载 / 解压


def download(url, dest, label):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 10 * 1024 * 1024:
        log(f"缓存命中：{os.path.basename(dest)}（{os.path.getsize(dest) / 1048576:.1f} MB）")
        return dest
    log(f"下载 {label} …")
    tmp = dest + ".part"
    start = time.time()
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("content-length") or 0)
        done = 0
        while True:
            chunk = r.read(1024 * 512)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total and done // (8 * 1024 * 1024) != (done - len(chunk)) // (8 * 1024 * 1024):
                pct = done * 100.0 / total
                log(f"  {done / 1048576:.0f}/{total / 1048576:.0f} MB（{pct:.0f}%）")
    os.replace(tmp, dest)
    log(f"下载完成：{os.path.getsize(dest) / 1048576:.1f} MB，{time.time() - start:.1f}s")
    return dest


def extract_zip(zip_path, dest):
    """按 zip 的 external_attr 还原权限与符号链接（Electron 的 mac 包里带 symlink）。"""
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            out = os.path.join(dest, info.filename)
            mode = (info.external_attr >> 16) & 0xFFFF
            if info.filename.endswith("/"):
                os.makedirs(out, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if mode and (mode & 0o170000) == 0o120000:  # 符号链接
                target = z.read(info).decode("utf-8")
                try:
                    os.symlink(target, out)
                except OSError:
                    # Windows 无权限创建符号链接时退回普通文件（mac 包内极少用到，仅日志提示）
                    with open(out, "w", encoding="utf-8") as f:
                        f.write(target)
                continue
            with z.open(info) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)
            if mode:
                os.chmod(out, mode & 0o777)
    return dest


# ----------------------------------------------------------------- 应用载荷


def read_version():
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def ignore_factory(exclude_names):
    def _ignore(dir_path, names):
        return [n for n in names if n in exclude_names]
    return _ignore


def copy_payload(app_dir, target, version):
    """把运行所需的应用代码放进 <app>/ 目录。"""
    os.makedirs(app_dir, exist_ok=True)
    for name in PAYLOAD_DIRS:
        src = os.path.join(ROOT, name)
        if not os.path.isdir(src):
            continue
        exclude = {"__pycache__", "node_modules"}
        shutil.copytree(src, os.path.join(app_dir, name), ignore=ignore_factory(exclude), dirs_exist_ok=True)
    for name in PAYLOAD_FILES:
        src = os.path.join(ROOT, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(app_dir, name))

    # package.json：改成目标平台可用的最小集（去掉 devDependencies，标出产品名）
    pkg_path = os.path.join(app_dir, "package.json")
    with open(pkg_path, encoding="utf-8") as f:
        pkg = json.load(f)
    pkg["version"] = version
    pkg["productName"] = "即译"
    pkg.pop("devDependencies", None)
    pkg["dependencies"] = {"onnxruntime-node": pkg.get("dependencies", {}).get("onnxruntime-node", "1.22.0")}
    with open(pkg_path, "w", encoding="utf-8") as f:
        json.dump(pkg, f, ensure_ascii=False, indent=2)

    # 运行时：OCR 模型（中日韩）随包；llama.cpp 二进制各平台需另备，这里放说明
    models_src = os.path.join(ROOT, "runtime", "ocr-rapid", "models")
    if os.path.isdir(models_src):
        shutil.copytree(models_src, os.path.join(app_dir, "runtime", "ocr-rapid", "models"), dirs_exist_ok=True)
    runtime_readme = os.path.join(app_dir, "runtime", "README.txt")
    os.makedirs(os.path.dirname(runtime_readme), exist_ok=True)
    with open(runtime_readme, "w", encoding="utf-8") as f:
        f.write(
            "runtime/ 目录说明\n"
            "================\n\n"
            "ocr-rapid/models/：PP-OCRv4 中/英、日文、韩文识别模型（Apache-2.0，来源 ModelScope RapidAI/RapidOCR），\n"
            "  随包分发，开箱可用。\n\n"
            "llama/：离线翻译用的 llama.cpp 运行时（llama-server）。\n"
            "  Windows 版本随安装包提供；macOS / Linux 版本未随包分发，原因见下：\n"
            "    - 体积（~60 MB）与平台二进制差异，逐平台构建维护成本高；\n"
            "    - 需要与目标机器 CPU 指令集匹配（x64 / arm64）。\n"
            "  需要离线翻译时：从 llama.cpp 官方 release 下载对应平台的 llama-server，\n"
            "  放到 runtime/llama/ 下并确认可执行（chmod +x），再把 GGUF 模型放到数据目录 models/。\n"
            "  没有该二进制时，应用仍可用联网 API 翻译，只是「离线优先」会提示运行时缺失。\n"
        )

    copy_onnxruntime(app_dir, target)


def copy_onnxruntime(app_dir, target):
    """只带目标平台的 onnxruntime 原生库（六个平台全带会让包体翻倍）。"""
    pnpm = os.path.join(ROOT, "node_modules", ".pnpm")
    ort_pkg = None
    common_pkg = None
    if os.path.isdir(pnpm):
        for name in os.listdir(pnpm):
            if name.startswith("onnxruntime-node@"):
                cand = os.path.join(pnpm, name, "node_modules", "onnxruntime-node")
                if os.path.isdir(cand):
                    ort_pkg = cand
                    sibling = os.path.join(pnpm, name, "node_modules", "onnxruntime-common")
                    if os.path.isdir(sibling):
                        common_pkg = sibling
                break
    if ort_pkg is None:
        raise SystemExit("找不到 onnxruntime-node，请先在 项目代码 目录安装依赖")
    dest_nodes = os.path.join(app_dir, "node_modules")
    os.makedirs(dest_nodes, exist_ok=True)
    dest_ort = os.path.join(dest_nodes, "onnxruntime-node")

    plat, arch = target["plat"], target["arch"]

    # bin/ 下形如 bin/napi-v6/<plat>/<arch>/…：只保留目标平台那一支。
    # 注意目录裁剪要按「前缀」判断——只比 leaf 名会把 bin/napi-v6/<plat> 整个剪掉。
    bin_root = os.path.join(ort_pkg, "bin")
    abi = None
    if os.path.isdir(bin_root):
        for name in os.listdir(bin_root):
            if name.startswith("napi"):
                abi = name
                break
    allowed = f"bin/{abi}/{plat}/{arch}" if abi else None

    def keep(src_path):
        rel = os.path.relpath(src_path, ort_pkg).replace("\\", "/")
        if not rel.startswith("bin/"):
            return True
        if not allowed:
            return False
        return allowed.startswith(rel) or rel.startswith(allowed)

    for base, dirs, files in os.walk(ort_pkg):
        for d in list(dirs):
            if not keep(os.path.join(base, d)):
                dirs.remove(d)
        for name in files:
            src = os.path.join(base, name)
            if not keep(src):
                continue
            rel = os.path.relpath(src, ort_pkg)
            dst = os.path.join(dest_ort, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            if name.endswith((".node", ".so", ".dylib", ".so.1")):
                os.chmod(dst, 0o755)
    if common_pkg:
        shutil.copytree(common_pkg, os.path.join(dest_nodes, "onnxruntime-common"), dirs_exist_ok=True)


# ----------------------------------------------------------------- 平台组装


def build_icns(png_path, icns_path):
    """把 512px PNG 打成最小可用的 ICNS（ic07/ic08/ic09 三个尺寸）。"""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        log("缺少 Pillow，跳过 .icns 生成（使用 Electron 默认图标）")
        return False
    with Image.open(png_path) as im:
        im = im.convert("RGBA")
        chunks = []
        for tag, size in (("ic07", 128), ("ic08", 256), ("ic09", 512)):
            tmp = os.path.join(os.path.dirname(icns_path), f".{tag}.png")
            ic = im.resize((size, size), Image.LANCZOS)
            ic.save(tmp, format="PNG")
            with open(tmp, "rb") as f:
                data = f.read()
            os.remove(tmp)
            chunks.append(tag.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    with open(icns_path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
    return True


PLIST_REPLACEMENTS = [
    (r"(<key>CFBundleExecutable</key>\s*<string>)[^<]*(</string>)", r"\g<1>即译\g<2>"),
    (r"(<key>CFBundleName</key>\s*<string>)[^<]*(</string>)", r"\g<1>即译\g<2>"),
    (r"(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)", r"\g<1>即译\g<2>"),
    (r"(<key>CFBundleIdentifier</key>\s*<string>)[^<]*(</string>)", r"\g<1>com.jiyi.translator\g<2>"),
    (r"(<key>CFBundleIconFile</key>\s*<string>)[^<]*(</string>)", r"\g<1>jiyi.icns\g<2>"),
    (r"(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*(</string>)", None),
]


def build_mac(target, version, stage_dir):
    app_src = os.path.join(stage_dir, "Electron.app")
    if not os.path.isdir(app_src):
        raise SystemExit(f"Electron 包里没有 Electron.app：{stage_dir}")
    app = os.path.join(stage_dir, "即译.app")
    if os.path.isdir(app):
        shutil.rmtree(app)
    shutil.move(app_src, app)

    contents = os.path.join(app, "Contents")
    macos_dir = os.path.join(contents, "MacOS")
    res_dir = os.path.join(contents, "Resources")

    # 主可执行文件改名（Info.plist 里的 CFBundleExecutable 同步改）
    exe = os.path.join(macos_dir, "Electron")
    if os.path.isfile(exe):
        os.rename(exe, os.path.join(macos_dir, "即译"))
        os.chmod(os.path.join(macos_dir, "即译"), 0o755)

    # 默认应用换成我们的 app 目录
    default_asar = os.path.join(res_dir, "default_app.asar")
    if os.path.isfile(default_asar):
        os.remove(default_asar)
    copy_payload(os.path.join(res_dir, "app"), target, version)
    # 运行时模型放 Resources/runtime（paths.PROJECT_ROOT 打包后 = Resources）
    models_app = os.path.join(res_dir, "app", "runtime")
    if os.path.isdir(models_app):
        shutil.move(models_app, os.path.join(res_dir, "runtime"))

    # 图标
    icon_src = os.path.join(ROOT, "assets", "app.png")
    icns = os.path.join(res_dir, "jiyi.icns")
    if build_icns(icon_src, icns):
        log("已生成 jiyi.icns")
        old_icns = os.path.join(res_dir, "electron.icns")
        if os.path.isfile(old_icns):
            os.remove(old_icns)

    # Info.plist 改写
    plist = os.path.join(contents, "Info.plist")
    with open(plist, encoding="utf-8") as f:
        text = f.read()
    for pattern, repl in PLIST_REPLACEMENTS:
        if repl is None:
            text = re.sub(pattern, rf"\g<1>{version}\g<2>", text)
        else:
            text = re.sub(pattern, repl, text)
    with open(plist, "w", encoding="utf-8") as f:
        f.write(text)

    # Helper 的 bundle id 也改掉，避免与其它 Electron 应用冲突（可执行文件名保持不变）
    frameworks = os.path.join(contents, "Frameworks")
    if os.path.isdir(frameworks):
        for base, _dirs, files in os.walk(frameworks):
            for name in files:
                if name != "Info.plist":
                    continue
                p = os.path.join(base, name)
                try:
                    with open(p, encoding="utf-8") as f:
                        t = f.read()
                except UnicodeDecodeError:
                    continue
                if "com.github.Electron" not in t:
                    continue
                t = t.replace("com.github.Electron", "com.jiyi.translator")
                with open(p, "w", encoding="utf-8") as f:
                    f.write(t)

    write_readme(os.path.join(stage_dir, "使用说明-macOS.txt"), "macOS", version)
    return app


def build_linux(target, version, stage_dir):
    # Electron 的 linux 包里，可执行文件就叫 electron
    exe = os.path.join(stage_dir, "electron")
    if os.path.isfile(exe):
        os.rename(exe, os.path.join(stage_dir, "即译"))
        os.chmod(os.path.join(stage_dir, "即译"), 0o755)
    # chrome-sandbox 需要 setuid，否则非 root 运行会报 "SUID sandbox helper ... not configured"
    sandbox = os.path.join(stage_dir, "chrome-sandbox")
    if os.path.isfile(sandbox):
        os.chmod(sandbox, 0o4755)

    res_dir = os.path.join(stage_dir, "resources")
    asar = os.path.join(res_dir, "default_app.asar")
    if os.path.isfile(asar):
        os.remove(asar)
    copy_payload(os.path.join(res_dir, "app"), target, version)
    models_app = os.path.join(res_dir, "app", "runtime")
    if os.path.isdir(models_app):
        shutil.move(models_app, os.path.join(res_dir, "runtime"))

    # 免安装包解压后 chrome-sandbox 的属主是当前用户，Chromium 会拒绝启用沙箱
    # （"SUID sandbox helper ... not configured"），所以随包给一个启动脚本，显式 --no-sandbox。
    wrapper = os.path.join(stage_dir, "即译.sh")
    with open(wrapper, "w", encoding="utf-8", newline="\n") as f:
        f.write(
            "#!/bin/sh\n"
            "# 即译 免安装版启动脚本\n"
            "# 解压后的 chrome-sandbox 不是 root 所有，Chromium 沙箱不可用，这里显式关闭\n"
            "# （与 Windows 版启动器一致）。若想启用沙箱，执行：\n"
            "#   sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox\n"
            "# 之后可把下面的 --no-sandbox 去掉。\n"
            'cd "$(dirname "$0")" || exit 1\n'
            'exec ./即译 --no-sandbox "$@"\n'
        )
    os.chmod(wrapper, 0o755)

    # .desktop 启动项
    desktop = os.path.join(stage_dir, "即译.desktop")
    # .desktop 规范要求 LF；Windows 上默认会写成 CRLF，个别桌面环境会把 \r 带进 Exec 导致启动失败
    with open(desktop, "w", encoding="utf-8", newline="\n") as f:
        f.write(
            "[Desktop Entry]\n"
            "Type=Application\n"
            "Name=即译\n"
            "Name[en]=Jiyi\n"
            "Comment=框选屏幕文字即时翻译\n"
            "Exec=sh -c 'cd \"$(dirname \"%k\")\" && ./即译.sh'\n"
            "Icon=jiyi\n"
            "Terminal=false\n"
            "Categories=Utility;Education;\n"
        )
    os.chmod(desktop, 0o755)
    png_src = os.path.join(ROOT, "assets", "app.png")
    if os.path.isfile(png_src):
        shutil.copy2(png_src, os.path.join(stage_dir, "jiyi.png"))

    write_readme(os.path.join(stage_dir, "使用说明-Linux.txt"), "Linux", version)
    return stage_dir


def write_readme(path, platform, version):
    lines = [
        f"即译 v{version}（{platform} 免安装版）",
        "=" * 40,
        "",
    ]
    if platform == "macOS":
        lines += [
            "1) 把「即译.app」拖到「应用程序」文件夹（或任意目录）。",
            "2) 首次打开：右键 → 打开（未签名应用，直接双击会被 Gatekeeper 拦下）。",
            "   若提示「已损坏」，在终端执行：",
            "     xattr -dr com.apple.quarantine /Applications/即译.app",
            "3) 首次运行会问你读取屏幕的权限：系统设置 → 隐私与安全性 → 屏幕录制，勾选「即译」。",
            "4) 想用离线翻译：把 llama-server（llama.cpp 的 macOS 构建）放到",
            "   即译.app/Contents/Resources/runtime/llama/，并把 GGUF 模型放到",
            "   ~/Library/Application Support/desktop-translator/models/。",
        ]
    else:
        lines += [
            "1) 解压后进入目录，运行 ./即译.sh（或双击「即译.desktop」加入启动器）。",
            "   脚本只是带 --no-sandbox 启动，因为解压出来 chrome-sandbox 不是 root 所有。",
            "2) 若提示缺少库：Debian/Ubuntu 安装 libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2。",
            "3) 想恢复 Chromium 沙箱：sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox，",
            "   然后去掉 即译.sh 里的 --no-sandbox。",
            "4) Wayland 下若窗口透明/穿透异常，可试 GDK_BACKEND=x11 ./即译.sh。",
            "5) 想用离线翻译：把 llama-server（llama.cpp 的 linux 构建）放到 runtime/llama/，",
            "   GGUF 模型放到 ~/.config/desktop-translator/models/。",
        ]
    lines += [
        "",
        "共 用 说 明：",
        "  - 框选翻译热键默认 Ctrl+Shift+T（macOS 为 ⌘⇧T），可在设置里改。",
        "  - 联网翻译需要在「设置 → API 接口」里填写你自己申请的接口地址与密钥。",
        "  - 所有截图只在本机处理，不会上传；只有「译文请求」会发往你配置的 API。",
        "",
        "注意：本包未做代码签名/公证（macOS）也未打包 AppImage（Linux），",
        "      属于免安装绿色版；不同发行版可能缺少系统库，见上文第 2 条。",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ----------------------------------------------------------------- 打包输出


def zip_tree(src_dir, out_zip, root_name):
    def mac_mode(rel):
        """Windows 上拿不到 unix 权限位，按 macOS 包的约定推断可执行文件。"""
        rel = rel.replace("\\", "/")
        name = rel.rsplit("/", 1)[-1]
        if "/Contents/MacOS/" in "/" + rel:
            return 0o755
        if name.endswith((".dylib", ".node", ".so")) or ".so." in name:
            return 0o755
        # Electron Framework.framework/Versions/A/Electron Framework 这类无扩展名的框架二进制
        if "/Versions/" in rel and "." not in name:
            return 0o755
        return 0o644

    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for base, dirs, files in os.walk(src_dir):
            for name in list(dirs):
                p = os.path.join(base, name)
                if os.path.islink(p):
                    arc = os.path.join(root_name, os.path.relpath(p, src_dir)).replace("\\", "/")
                    zi = zipfile.ZipInfo(arc)
                    zi.create_system = 3
                    zi.external_attr = (0o120777 << 16)
                    z.writestr(zi, os.readlink(p))
                    dirs.remove(name)
            for name in files:
                p = os.path.join(base, name)
                rel = os.path.relpath(p, src_dir).replace("\\", "/")
                arc = os.path.join(root_name, rel).replace("\\", "/")
                if os.path.islink(p):
                    zi = zipfile.ZipInfo(arc)
                    zi.create_system = 3
                    zi.external_attr = (0o120777 << 16)
                    z.writestr(zi, os.readlink(p))
                    continue
                zi = zipfile.ZipInfo.from_file(p, arc)
                zi.create_system = 3
                # from_file() 会带 ZIP_STORED，必须显式改回 DEFLATE，否则 zip 不压缩（mac 包曾因此 305MB）
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = ((0o100000 | mac_mode(rel)) << 16)
                with open(p, "rb") as fsrc, z.open(zi, "w") as fdst:
                    shutil.copyfileobj(fsrc, fdst)


def tar_tree(src_dir, out_tar, root_name):
    """自己写 TarInfo：Windows 上 os.stat 拿不到 unix 权限位（全是 666），
    但 Linux 上执行位一旦丢失，双击/命令行都起不来，所以这里按文件类型显式给权限。"""
    executable_names = {"即译", "jiyi", "chrome-sandbox"}
    executable_ext = (".sh", ".desktop", ".so", ".dylib", ".node", ".so.1")

    def mode_for(rel_path):
        name = os.path.basename(rel_path)
        if name in executable_names:
            return 0o4755 if name == "chrome-sandbox" else 0o755
        if name.endswith(executable_ext) or ".so." in name:
            return 0o755
        return 0o644

    with tarfile.open(out_tar, "w:gz") as t:
        for base, dirs, files in os.walk(src_dir):
            rel_base = os.path.relpath(base, src_dir)
            arc_dir = root_name if rel_base == "." else os.path.join(root_name, rel_base)
            info = tarfile.TarInfo(arc_dir.replace("\\", "/"))
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.mtime = int(time.time())
            t.addfile(info)
            for name in files:
                p = os.path.join(base, name)
                rel = os.path.join(rel_base, name) if rel_base != "." else name
                arc = os.path.join(root_name, rel).replace("\\", "/")
                info = tarfile.TarInfo(arc)
                info.size = os.path.getsize(p)
                info.mode = mode_for(rel)
                info.mtime = int(os.path.getmtime(p))
                with open(p, "rb") as f:
                    t.addfile(info, f)


def build(target_key, version):
    target = TARGETS[target_key]
    name = target["electron"]
    url = MIRROR.format(ver="28.3.3", name=name)
    zip_path = os.path.join(CACHE, f"electron-v28.3.3-{name}.zip")
    download(url, zip_path, f"Electron 28.3.3 {name}")

    stage_dir = os.path.join(STAGE, target_key)
    log(f"解压到 {stage_dir}")
    extract_zip(zip_path, stage_dir)

    if target["plat"] == "darwin":
        root = build_mac(target, version, stage_dir)
        base = f"即译-{version}-{target['os']}-{target['arch']}"
        out_zip = os.path.join(OUT, base + ".zip")
        os.makedirs(OUT, exist_ok=True)
        log("压缩 zip（保留符号链接与可执行位）…")
        zip_tree(root, out_zip, "即译.app")
        return out_zip
    root = build_linux(target, version, stage_dir)
    base = f"即译-{version}-{target['os']}-{target['arch']}"
    out_tar = os.path.join(OUT, base + ".tar.gz")
    os.makedirs(OUT, exist_ok=True)
    log("打包 tar.gz（保留权限位）…")
    tar_tree(root, out_tar, f"即译-{target['os']}-{target['arch']}")
    return out_tar


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="all", choices=list(TARGETS) + ["all"])
    ap.add_argument("--version", default=None)
    args = ap.parse_args()
    version = args.version or read_version()
    keys = list(TARGETS) if args.target == "all" else [args.target]
    results = []
    for key in keys:
        log(f"==== 构建 {key}（v{version}）====")
        path = build(key, version)
        size = os.path.getsize(path) / 1048576
        log(f"完成：{path}（{size:.1f} MB）")
        results.append((key, path, size))
    print()
    for key, path, size in results:
        print(f"{key:12s} {size:8.1f} MB  {path}")


if __name__ == "__main__":
    sys.exit(main())
