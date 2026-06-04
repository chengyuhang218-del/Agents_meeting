# Setup

## Requirements

- Python 3.10+
- OpenClaw installed and configured on the same machine
- Optional: Google Chrome for browser-backed PubMed search

## Install

```bash
git clone https://github.com/your-name/agent-meetting.git
cd agent-meetting
python3 -m pip install -e .
```

## Run

```bash
python3 -m agent_meetting serve --host 127.0.0.1 --port 8765
```

Open the printed local URL.

## Optional Browser Search

Browser search requires Playwright:

```bash
python3 -m pip install "playwright>=1.44"
```

The app uses the local Chrome app when available, so a Playwright browser
download is usually not required on macOS.

