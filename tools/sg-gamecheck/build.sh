#!/bin/bash
# Builds SoulGold's own save code (src/save.c) for the GBA CPU, with a tiny harness, so gamecheck.py can run it.
# Usage: tools/sg-gamecheck/build.sh <soulgold repo> <arm-none-eabi bin folder>
set -e
REPO="$1"; BIN="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/build"; mkdir -p "$OUT"
CC="$BIN/arm-none-eabi-gcc -mthumb -mthumb-interwork -mabi=apcs-gnu -mcpu=arm7tdmi -O2 -std=gnu17 -w -ffreestanding -fno-builtin"
cd "$REPO"
for f in src/save.c "$HERE/harness.c"; do
  "$BIN/arm-none-eabi-gcc" -E -iquote include -iquote gflib -iquote . -DMODERN=1 -DTESTING=0 -DEMERALD -DRELEASE -std=gnu17 "$f" \
    | python3 -c "import re,sys; sys.stdout.write(re.sub(r'INCBIN_[A-Z0-9]+\(\s*\"[^\"]*\"(\s*,\s*\"[^\"]*\")*\s*\)','{0}',sys.stdin.read()))" \
    | tools/preproc/preproc -i "$f" charmap.txt | $CC -x c -c -o "$OUT/$(basename "$f" .c).o" -
done
$CC -c -o "$OUT/stubs.o" "$HERE/stubs.c"
"$BIN/arm-none-eabi-gcc" -mthumb -mabi=apcs-gnu -mcpu=arm7tdmi -nostdlib -T "$HERE/link.ld" -o "$OUT/h.elf" "$OUT/save.o" "$OUT/harness.o" "$OUT/stubs.o"
"$BIN/arm-none-eabi-objcopy" -O binary "$OUT/h.elf" "$OUT/h.bin"
"$BIN/arm-none-eabi-nm" "$OUT/h.elf" > "$OUT/h.sym"
echo "built $OUT/h.bin"
