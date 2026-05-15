"""Подготовка скриншотов из adb screencap к загрузке в RuStore Console.

RuStore требует 9:16 (portrait) или 16:9 (landscape) для секции «Скриншоты
для телефонов». Современные Android-устройства дают 1080×2400 (9:20) —
не подходит, режется при загрузке.

Скрипт:
  1. Open input PNG/JPG (любого размера).
  2. Если ratio == 9:16 — pass-through (опционально resize до 1080×1920).
  3. Если ratio < 9:16 (например 9:20) — top-crop по высоте до 9:16,
     сохраняя верхнюю часть (status bar + контент).
  4. Если ratio > 9:16 (landscape или близко к 16:9) — center-crop по ширине.
  5. LANCZOS resize до 1080×1920, save с quality=95 (JPG) или PNG.

Использование:
  python tools/rustore/process_screenshots.py INPUT OUTPUT [--bottom-bias]
  python tools/rustore/process_screenshots.py INPUT_DIR OUTPUT_DIR [--bottom-bias]

  --bottom-bias  Crop с центра вверх вместо top-bias (по умолчанию сохраняем
                 status bar + header).

Зависимости: Pillow (pip install Pillow).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('ERROR: Pillow not installed. Run: pip install Pillow')

TARGET_W, TARGET_H = 1080, 1920  # 9:16 portrait
TARGET_RATIO = TARGET_W / TARGET_H  # 0.5625


def process_one(src: Path, dst: Path, bottom_bias: bool = False) -> None:
    im = Image.open(src).convert('RGB')
    w, h = im.size
    ratio = w / h

    if abs(ratio - TARGET_RATIO) < 0.001:
        # уже 9:16, просто resize
        cropped = im
    elif ratio < TARGET_RATIO:
        # вытянутый по высоте (9:20 от Android phones) — обрезаем низ
        new_h = round(w / TARGET_RATIO)
        top = (h - new_h) if bottom_bias else 0
        cropped = im.crop((0, top, w, top + new_h))
    else:
        # шире чем 9:16 — center-crop по ширине
        new_w = round(h * TARGET_RATIO)
        left = (w - new_w) // 2
        cropped = im.crop((left, 0, left + new_w, h))

    if cropped.size != (TARGET_W, TARGET_H):
        cropped = cropped.resize((TARGET_W, TARGET_H), Image.LANCZOS)

    dst.parent.mkdir(parents=True, exist_ok=True)
    fmt = 'JPEG' if dst.suffix.lower() in {'.jpg', '.jpeg'} else 'PNG'
    save_kwargs = {'quality': 95} if fmt == 'JPEG' else {}
    cropped.save(dst, fmt, **save_kwargs)
    print(f'{src.name} {w}x{h} (ratio={ratio:.4f}) -> {dst} {TARGET_W}x{TARGET_H}')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input', help='input file or directory')
    ap.add_argument('output', help='output file (if input is file) or directory')
    ap.add_argument('--bottom-bias', action='store_true',
                    help='center-crop by keeping bottom half (default: top-bias)')
    args = ap.parse_args()

    src = Path(args.input)
    dst = Path(args.output)

    if src.is_file():
        process_one(src, dst, bottom_bias=args.bottom_bias)
    elif src.is_dir():
        for f in sorted(src.iterdir()):
            if f.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
                process_one(f, dst / f.name, bottom_bias=args.bottom_bias)
    else:
        sys.exit(f'ERROR: input {src} not found')


if __name__ == '__main__':
    main()
