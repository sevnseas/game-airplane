#!/usr/bin/env bash
# Re-export the A350 exterior from blender/a350 into public/models/a350.glb
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
SRC="${1:-../blender/a350/A350-1000.blend}"
"$BLENDER" --background "$(wslpath -w "$SRC")" --python "$(wslpath -w export_a350.py)" -- "$(wslpath -w ../public/models/a350.glb)" 2>&1 | grep -E "EXPORT|Error|Traceback"
