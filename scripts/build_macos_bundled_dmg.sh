#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.1.1}"
APP_NAME="Agent Meeting Desktop"
APP_DIR="$ROOT_DIR/dist/${APP_NAME}.app"
DMG_PATH="$ROOT_DIR/dist/Agent-Meeting-Desktop-${VERSION}-bundled-macOS.dmg"
STAGING_DIR="$ROOT_DIR/dist/dmg-bundled-staging"
PYI_WORK="$ROOT_DIR/build/pyinstaller"
PYI_DIST="$ROOT_DIR/dist/pyinstaller"
PYI_APP="$PYI_DIST/agent-meeting-runtime"
NODE_SOURCE="${AGENTMEETING_NODE_SOURCE:-/opt/homebrew/Cellar/node/26.0.0}"
OPENCLAW_SOURCE="${AGENTMEETING_OPENCLAW_SOURCE:-/opt/homebrew/lib/node_modules/openclaw}"

if [[ ! -d "$NODE_SOURCE" ]]; then
  echo "Missing Node runtime source: $NODE_SOURCE" >&2
  exit 1
fi

if [[ ! -d "$OPENCLAW_SOURCE" ]]; then
  echo "Missing OpenClaw package source: $OPENCLAW_SOURCE" >&2
  exit 1
fi

rm -rf "$PYI_WORK" "$PYI_DIST" "$APP_DIR" "$DMG_PATH" "$STAGING_DIR"
mkdir -p "$PYI_WORK" "$PYI_DIST"

python -m PyInstaller \
  --clean \
  --noconfirm \
  --onedir \
  --name agent-meeting-runtime \
  --workpath "$PYI_WORK" \
  --distpath "$PYI_DIST" \
  --collect-data agent_meetting \
  --collect-submodules agent_meetting \
  "$ROOT_DIR/scripts/pyinstaller_entry.py"

mkdir -p \
  "$APP_DIR/Contents/MacOS" \
  "$APP_DIR/Contents/Resources/runtime" \
  "$APP_DIR/Contents/Resources/runtime/bin" \
  "$APP_DIR/Contents/Resources/python-app"

cp -R "$PYI_APP" "$APP_DIR/Contents/Resources/python-app/agent-meeting-runtime"
cp -R "$NODE_SOURCE" "$APP_DIR/Contents/Resources/runtime/node"
cp -R "$OPENCLAW_SOURCE" "$APP_DIR/Contents/Resources/runtime/openclaw"
rm -f \
  "$APP_DIR/Contents/Resources/runtime/node/bin/npm" \
  "$APP_DIR/Contents/Resources/runtime/node/bin/npx" \
  "$APP_DIR/Contents/Resources/runtime/node/bin/corepack"

if [[ -f "$ROOT_DIR/dist/Agent Meeting Desktop.app/Contents/Resources/Meeting.icns" ]]; then
  cp "$ROOT_DIR/dist/Agent Meeting Desktop.app/Contents/Resources/Meeting.icns" "$APP_DIR/Contents/Resources/Meeting.icns"
fi

cat > "$APP_DIR/Contents/Resources/runtime/bin/openclaw" <<'OPENCLAW'
#!/usr/bin/env bash
set -euo pipefail

WRAPPER_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$(cd "$WRAPPER_DIR/.." && pwd)"
APP_SUPPORT="${AGENTMEETING_HOME:-$HOME/Library/Application Support/AgentMeeting}"

mkdir -p "$APP_SUPPORT/openclaw" "$APP_SUPPORT/openclaw/state" "$APP_SUPPORT/logs"

export PATH="$RUNTIME_DIR/node/bin:$PATH"
export OPENCLAW_HOME="${OPENCLAW_HOME:-$APP_SUPPORT/openclaw-home}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$APP_SUPPORT/openclaw/openclaw.json}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$APP_SUPPORT/openclaw/state}"
export OPENCLAW_CLI_DISABLE_FANCY=1

exec "$RUNTIME_DIR/node/bin/node" "$RUNTIME_DIR/openclaw/openclaw.mjs" "$@"
OPENCLAW
chmod +x "$APP_DIR/Contents/Resources/runtime/bin/openclaw"

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
  <key>CFBundleIconFile</key>
  <string>Meeting</string>
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
APP_SUPPORT="$HOME/Library/Application Support/AgentMeeting"
LOG_DIR="$APP_SUPPORT/logs"
LOG_FILE="$LOG_DIR/launcher.log"
PY_APP="$RESOURCES/python-app/agent-meeting-runtime/agent-meeting-runtime"
OPENCLAW_WRAPPER="$RESOURCES/runtime/bin/openclaw"
NODE_BIN="$RESOURCES/runtime/node/bin/node"

mkdir -p "$APP_SUPPORT" "$LOG_DIR" "$APP_SUPPORT/openclaw" "$APP_SUPPORT/openclaw/state"
exec >>"$LOG_FILE" 2>&1

show_error() {
  local message="$1"
  osascript -e "display alert \"Agent Meeting Desktop 启动失败\" message \"$message\\n\\n日志：$LOG_FILE\"" || true
}

trap 'show_error "内置运行环境启动失败。请重新下载 App，或查看日志。"' ERR

echo "---- $(date) starting bundled Agent Meeting Desktop ----"
echo "Python app: $PY_APP"
echo "Node: $NODE_BIN"
echo "OpenClaw: $OPENCLAW_WRAPPER"

if [[ ! -x "$PY_APP" ]]; then
  show_error "缺少 App 内置 Python runtime。"
  exit 1
fi

if [[ ! -x "$NODE_BIN" || ! -x "$OPENCLAW_WRAPPER" ]]; then
  show_error "缺少 App 内置 OpenClaw/Node runtime。"
  exit 1
fi

export AGENTMEETING_HOME="$APP_SUPPORT"
export AGENTMEETING_BUNDLED_NODE="$NODE_BIN"
export AGENT_MEETTING_OPENCLAW_BIN="$OPENCLAW_WRAPPER"
export OPENCLAW_BIN="$OPENCLAW_WRAPPER"
export OPENCLAW_HOME="$APP_SUPPORT/openclaw-home"
export OPENCLAW_CONFIG_PATH="$APP_SUPPORT/openclaw/openclaw.json"
export OPENCLAW_STATE_DIR="$APP_SUPPORT/openclaw/state"
export PATH="$RESOURCES/runtime/bin:$RESOURCES/runtime/node/bin:$PATH"

cd "$APP_SUPPORT"
exec "$PY_APP" app --host 127.0.0.1 --port 8765
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

echo "Built bundled DMG: $DMG_PATH"
