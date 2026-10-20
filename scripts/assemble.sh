#!/usr/bin/env bash
# assemble.sh <format> <chunks_dir> <audio.wav> <output.mp4>
# Concatenates the chunk videos (stream copy), then muxes loudness-normalised AAC audio.
set -euo pipefail
FORMAT="$1"; DIR="$2"; AUDIO="$3"; OUT="$4"
LIST="$(mktemp)"
for f in $(ls "$DIR"/chunk-"$FORMAT"-*/video.mp4 | sort); do echo "file '$(realpath "$f")'" >> "$LIST"; done
cat "$LIST"
ffmpeg -y -f concat -safe 0 -i "$LIST" -i "$AUDIO" -map 0:v:0 -map 1:a:0 -c:v copy \
  -c:a aac -b:a 192k -af "loudnorm=I=-16:TP=-1.5:LRA=11" -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
