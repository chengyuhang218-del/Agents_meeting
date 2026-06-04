#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.1.1}"
APP_NAME="Agent Meeting Desktop"
APP_DIR="$ROOT_DIR/dist/${APP_NAME}.app"
DMG_PATH="$ROOT_DIR/dist/Agent-Meeting-Desktop-${VERSION}-macOS.dmg"
STAGING_DIR="$ROOT_DIR/dist/dmg-staging"
WHEEL_NAME="agent_meetting-${VERSION}-py3-none-any.whl"
WHEEL_PATH="$ROOT_DIR/packages/$WHEEL_NAME"

if [[ ! -f "$WHEEL_PATH" ]]; then
  echo "Missing wheel: $WHEEL_PATH" >&2
  exit 1
fi

rm -rf "$APP_DIR" "$DMG_PATH" "$STAGING_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cp "$WHEEL_PATH" "$APP_DIR/Contents/Resources/$WHEEL_NAME"

ICONSET_DIR="$ROOT_DIR/dist/Meeting.iconset"
ICON_PNG="$ROOT_DIR/dist/meeting-icon-1024.png"
rm -rf "$ICONSET_DIR" "$ICON_PNG"
mkdir -p "$ICONSET_DIR"

python3 - "$ICON_PNG" <<'PY'
from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

out = Path(sys.argv[1])
size = 1024
raw = bytearray(size * size * 4)

font = {
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
}

def put(x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if 0 <= x < size and 0 <= y < size:
        idx = (y * size + x) * 4
        alpha = color[3] / 255
        for i in range(3):
            raw[idx + i] = int(color[i] * alpha + raw[idx + i] * (1 - alpha))
        raw[idx + 3] = 255

for y in range(size):
    for x in range(size):
        dx, dy = x - 512, y - 512
        glow = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy) / 650)
        idx = (y * size + x) * 4
        raw[idx:idx + 4] = bytes((34 + int(glow * 30), 111 + int(glow * 58), 96 + int(glow * 55), 255))

for y in range(310, 590):
    for x in range(172, 852):
        if ((x - 512) / 345) ** 2 + ((y - 448) / 145) ** 2 <= 1:
            put(x, y, (238, 250, 247, 238))

for angle in range(0, 360, 45):
    rad = math.radians(angle)
    px = int(512 + math.cos(rad) * 315)
    py = int(448 + math.sin(rad) * 205)
    for yy in range(py - 39, py + 40):
        for xx in range(px - 39, px + 40):
            if (xx - px) ** 2 + (yy - py) ** 2 <= 39 ** 2:
                put(xx, yy, (255, 213, 82, 245))

for y in range(650, 822):
    for x in range(102, 922):
        rx = min(x - 102, 921 - x)
        ry = min(y - 650, 821 - y)
        if rx >= 34 or ry >= 34 or (rx - 34) ** 2 + (ry - 34) ** 2 <= 34 ** 2:
            put(x, y, (19, 34, 40, 236))

text = "MEETING"
scale = 18
gap = 14
total_width = len(text) * 5 * scale + (len(text) - 1) * gap
x0 = (size - total_width) // 2
y0 = 700
for i, ch in enumerate(text):
    gx = x0 + i * (5 * scale + gap)
    for row, line in enumerate(font[ch]):
        for col, bit in enumerate(line):
            if bit == "1":
                for yy in range(y0 + row * scale, y0 + (row + 1) * scale - 2):
                    for xx in range(gx + col * scale, gx + (col + 1) * scale - 2):
                        put(xx, yy, (255, 255, 255, 255))

def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

scanlines = bytearray()
for y in range(size):
    scanlines.append(0)
    scanlines.extend(raw[y * size * 4:(y + 1) * size * 4])

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(scanlines), 9))
png += chunk(b"IEND", b"")
out.write_bytes(png)
PY

for icon in \
  icon_16x16.png:16 \
  icon_16x16@2x.png:32 \
  icon_32x32.png:32 \
  icon_32x32@2x.png:64 \
  icon_128x128.png:128 \
  icon_128x128@2x.png:256 \
  icon_256x256.png:256 \
  icon_256x256@2x.png:512 \
  icon_512x512.png:512 \
  icon_512x512@2x.png:1024
do
  name="${icon%%:*}"
  px="${icon##*:}"
  sips -z "$px" "$px" "$ICON_PNG" --out "$ICONSET_DIR/$name" >/dev/null
done
iconutil -c icns "$ICONSET_DIR" -o "$APP_DIR/Contents/Resources/Meeting.icns"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>agent-meeting-desktop</string>
  <key>CFBundleIdentifier</key>
  <string>com.agentmeeting.desktop</string>
  <key>CFBundleIconFile</key>
  <string>Meeting</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/agent-meeting-desktop" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$APP_ROOT/Resources"
WHEEL="$(ls "$RESOURCES"/agent_meetting-*-py3-none-any.whl | head -n 1)"
APP_SUPPORT="$HOME/Library/Application Support/Agent Meeting Desktop"
VENV_DIR="$APP_SUPPORT/venv"
LOG_DIR="$APP_SUPPORT/logs"
LOG_FILE="$LOG_DIR/launcher.log"

mkdir -p "$APP_SUPPORT" "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1

echo "---- $(date) starting Agent Meeting Desktop ----"

show_error() {
  local message="$1"
  osascript -e "display alert \"Agent Meeting Desktop 启动失败\" message \"$message\\n\\n日志：$LOG_FILE\"" || true
}

trap 'show_error "启动过程中发生错误。请确认已安装 Python 3，并查看日志。"' ERR

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  if [[ -x /opt/homebrew/bin/python3 ]]; then
    echo /opt/homebrew/bin/python3
    return 0
  fi
  if [[ -x /usr/local/bin/python3 ]]; then
    echo /usr/local/bin/python3
    return 0
  fi
  return 1
}

PYTHON="$(find_python || true)"
if [[ -z "$PYTHON" ]]; then
  osascript -e 'display alert "Python 3 未检测到" message "请先安装 Python 3，然后重新打开 Agent Meeting Desktop。"'
  exit 1
fi

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --no-deps --upgrade "$WHEEL"

if ! command -v openclaw >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/openclaw ]] && [[ ! -x /usr/local/bin/openclaw ]]; then
  osascript -e 'display notification "未检测到 openclaw；界面仍会启动，但真实 Agent 调用需要先安装 OpenClaw。" with title "Agent Meeting Desktop"'
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$APP_SUPPORT"
exec "$VENV_DIR/bin/agent-meeting" app --host 127.0.0.1 --port 8765
LAUNCHER

chmod +x "$APP_DIR/Contents/MacOS/agent-meeting-desktop"
printf 'APPL????' > "$APP_DIR/Contents/PkgInfo"
xattr -cr "$APP_DIR" || true
codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || true

mkdir -p "$STAGING_DIR"
cp -R "$APP_DIR" "$STAGING_DIR/${APP_NAME}.app"
ln -s /Applications "$STAGING_DIR/Applications"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"
rm -rf "$STAGING_DIR"

echo "Built: $DMG_PATH"
