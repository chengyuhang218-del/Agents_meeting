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

"$VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install --upgrade "$WHEEL"

if ! command -v openclaw >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/openclaw ]] && [[ ! -x /usr/local/bin/openclaw ]]; then
  osascript -e 'display notification "未检测到 openclaw；界面仍会启动，但真实 Agent 调用需要先安装 OpenClaw。" with title "Agent Meeting Desktop"'
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$APP_SUPPORT"
exec "$VENV_DIR/bin/agent-meeting" app --host 127.0.0.1 --port 8765
LAUNCHER

chmod +x "$APP_DIR/Contents/MacOS/agent-meeting-desktop"

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
