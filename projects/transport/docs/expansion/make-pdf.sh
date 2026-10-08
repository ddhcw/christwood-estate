#!/bin/bash
# Render one-pager.html to a print-ready A4 PDF using headless Chrome.
# Usage: ./make-pdf.sh [input.html] [output.pdf]
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IN="${1:-$(cd "$(dirname "$0")" && pwd)/one-pager.html}"
OUT="${2:-${IN%.html}.pdf}"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME"; exit 1; }
[ -f "$IN" ]     || { echo "No such file: $IN"; exit 1; }

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" --virtual-time-budget=10000 "file://$IN" 2>/dev/null

echo "Wrote $OUT"
command -v pdfinfo >/dev/null && pdfinfo "$OUT" | grep -E '^(Pages|Page size)'
