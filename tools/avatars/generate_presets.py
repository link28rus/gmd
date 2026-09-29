"""Генератор стандартных аватаров ребёнка (зверята).

Один источник для web и mobile-parent: пишет SVG в
apps/web/public/avatars/ и apps/mobile-parent/assets/avatars/.
Список id должен совпадать с CHILD_AVATAR_PRESETS в backend.

Запуск: python tools/avatars/generate_presets.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIRS = [
    ROOT / "apps/web/public/avatars",
    ROOT / "apps/mobile-parent/assets/avatars",
]
E = "#2B2B2B"  # глаза

PRESETS = {
    "fox": ("#FDE7D3", f"""
<path d="M26 26 L56 46 L34 66 Z" fill="#E8691B"/><path d="M102 26 L72 46 L94 66 Z" fill="#E8691B"/>
<path d="M33 36 L48 47 L38 57 Z" fill="#5A3420"/><path d="M95 36 L80 47 L90 57 Z" fill="#5A3420"/>
<path d="M26 62 Q26 42 64 42 Q102 42 102 62 Q102 90 64 106 Q26 90 26 62 Z" fill="#F07C2A"/>
<path d="M36 74 Q52 70 64 84 Q76 70 92 74 Q86 96 64 106 Q42 96 36 74 Z" fill="#FFF7EE"/>
<circle cx="49" cy="66" r="4.5" fill="{E}"/><circle cx="79" cy="66" r="4.5" fill="{E}"/>
<ellipse cx="64" cy="90" rx="6" ry="4.5" fill="{E}"/>"""),
    "bear": ("#EADFD3", f"""
<circle cx="36" cy="40" r="15" fill="#8B5A3C"/><circle cx="92" cy="40" r="15" fill="#8B5A3C"/>
<circle cx="36" cy="40" r="7" fill="#C8987A"/><circle cx="92" cy="40" r="7" fill="#C8987A"/>
<circle cx="64" cy="70" r="38" fill="#8B5A3C"/><ellipse cx="64" cy="84" rx="18" ry="14" fill="#D9B08C"/>
<circle cx="49" cy="64" r="4.5" fill="{E}"/><circle cx="79" cy="64" r="4.5" fill="{E}"/>
<ellipse cx="64" cy="78" rx="7" ry="5" fill="#3A2418"/>
<path d="M58 88 Q64 94 70 88" stroke="#3A2418" stroke-width="2.5" fill="none" stroke-linecap="round"/>"""),
    "panda": ("#DDEFE3", """
<circle cx="34" cy="38" r="15" fill="#262626"/><circle cx="94" cy="38" r="15" fill="#262626"/>
<circle cx="64" cy="70" r="40" fill="#FFFFFF"/>
<ellipse cx="47" cy="66" rx="10" ry="14" transform="rotate(25 47 66)" fill="#262626"/>
<ellipse cx="81" cy="66" rx="10" ry="14" transform="rotate(-25 81 66)" fill="#262626"/>
<circle cx="48" cy="64" r="4" fill="#FFFFFF"/><circle cx="80" cy="64" r="4" fill="#FFFFFF"/>
<ellipse cx="64" cy="82" rx="6" ry="4.5" fill="#262626"/>
<path d="M58 90 Q64 95 70 90" stroke="#262626" stroke-width="2.5" fill="none" stroke-linecap="round"/>"""),
    "cat": ("#E6E3F7", f"""
<path d="M28 30 L54 46 L30 68 Z" fill="#8E86A8"/><path d="M100 30 L74 46 L98 68 Z" fill="#8E86A8"/>
<path d="M33 39 L46 48 L34 59 Z" fill="#F4B6C6"/><path d="M95 39 L82 48 L94 59 Z" fill="#F4B6C6"/>
<ellipse cx="64" cy="74" rx="40" ry="34" fill="#8E86A8"/>
<ellipse cx="49" cy="70" rx="5" ry="6" fill="#B7E36A"/><ellipse cx="79" cy="70" rx="5" ry="6" fill="#B7E36A"/>
<ellipse cx="49" cy="70" rx="1.8" ry="5" fill="{E}"/><ellipse cx="79" cy="70" rx="1.8" ry="5" fill="{E}"/>
<path d="M59 82 L69 82 L64 88 Z" fill="#F48FB1"/>
<path d="M64 88 Q60 94 55 92 M64 88 Q68 94 73 92" stroke="#4A4560" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M40 84 L22 80 M40 90 L22 92 M88 84 L106 80 M88 90 L106 92" stroke="#4A4560" stroke-width="1.8" stroke-linecap="round"/>"""),
    "bunny": ("#FCE4EC", f"""
<ellipse cx="48" cy="34" rx="10" ry="27" fill="#F5F2F5"/><ellipse cx="80" cy="34" rx="10" ry="27" fill="#F5F2F5"/>
<ellipse cx="48" cy="36" rx="5" ry="19" fill="#F8BBD0"/><ellipse cx="80" cy="36" rx="5" ry="19" fill="#F8BBD0"/>
<circle cx="64" cy="80" r="34" fill="#F5F2F5"/>
<circle cx="51" cy="76" r="4.5" fill="{E}"/><circle cx="77" cy="76" r="4.5" fill="{E}"/>
<circle cx="43" cy="88" r="6" fill="#F8BBD0"/><circle cx="85" cy="88" r="6" fill="#F8BBD0"/>
<ellipse cx="64" cy="86" rx="5" ry="3.5" fill="#EC6F98"/>
<path d="M64 89 L64 94 M58 97 Q64 100 70 97" stroke="#8A6A75" stroke-width="2" fill="none" stroke-linecap="round"/>"""),
    "owl": ("#E3EEF9", f"""
<path d="M26 36 L44 46 L30 58 Z" fill="#7B5B4C"/><path d="M102 36 L84 46 L98 58 Z" fill="#7B5B4C"/>
<path d="M26 56 Q26 40 64 40 Q102 40 102 56 L102 84 Q102 110 64 110 Q26 110 26 84 Z" fill="#8D6E63"/>
<path d="M40 94 Q64 84 88 94 Q84 110 64 110 Q44 110 40 94 Z" fill="#D7B99F"/>
<circle cx="48" cy="66" r="15" fill="#FFFFFF"/><circle cx="80" cy="66" r="15" fill="#FFFFFF"/>
<circle cx="48" cy="66" r="7.5" fill="{E}"/><circle cx="80" cy="66" r="7.5" fill="{E}"/>
<circle cx="50" cy="63" r="2.5" fill="#FFFFFF"/><circle cx="82" cy="63" r="2.5" fill="#FFFFFF"/>
<path d="M58 80 L70 80 L64 90 Z" fill="#F5A623"/>"""),
    "penguin": ("#DCEBF7", f"""
<circle cx="64" cy="70" r="40" fill="#263238"/>
<circle cx="51" cy="76" r="21" fill="#FFFFFF"/><circle cx="77" cy="76" r="21" fill="#FFFFFF"/>
<rect x="51" y="76" width="26" height="21" fill="#FFFFFF"/>
<circle cx="52" cy="70" r="4.5" fill="{E}"/><circle cx="76" cy="70" r="4.5" fill="{E}"/>
<path d="M56 80 L72 80 L64 90 Z" fill="#FFA726"/>
<circle cx="42" cy="84" r="5" fill="#F8BBD0"/><circle cx="86" cy="84" r="5" fill="#F8BBD0"/>"""),
    "frog": ("#E6F4D7", f"""
<circle cx="42" cy="46" r="17" fill="#5DBB63"/><circle cx="86" cy="46" r="17" fill="#5DBB63"/>
<ellipse cx="64" cy="80" rx="44" ry="30" fill="#5DBB63"/>
<circle cx="42" cy="46" r="10" fill="#FFFFFF"/><circle cx="86" cy="46" r="10" fill="#FFFFFF"/>
<circle cx="43" cy="47" r="5" fill="{E}"/><circle cx="85" cy="47" r="5" fill="{E}"/>
<path d="M42 84 Q64 102 86 84" stroke="#2E7D32" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<circle cx="34" cy="80" r="6" fill="#F48FB1" opacity="0.7"/><circle cx="94" cy="80" r="6" fill="#F48FB1" opacity="0.7"/>
<circle cx="58" cy="72" r="1.8" fill="#2E7D32"/><circle cx="70" cy="72" r="1.8" fill="#2E7D32"/>"""),
    "lion": ("#FFF1CC", f"""
<g fill="#D98A2B"><circle cx="64" cy="26" r="16"/><circle cx="94" cy="38" r="16"/><circle cx="104" cy="68" r="16"/>
<circle cx="94" cy="98" r="16"/><circle cx="64" cy="108" r="16"/><circle cx="34" cy="98" r="16"/>
<circle cx="24" cy="68" r="16"/><circle cx="34" cy="38" r="16"/><circle cx="64" cy="67" r="40"/></g>
<circle cx="42" cy="44" r="9" fill="#F6C35A"/><circle cx="86" cy="44" r="9" fill="#F6C35A"/>
<circle cx="64" cy="70" r="31" fill="#F6C35A"/><ellipse cx="64" cy="84" rx="15" ry="11" fill="#FFE7A8"/>
<circle cx="52" cy="64" r="4.5" fill="{E}"/><circle cx="76" cy="64" r="4.5" fill="{E}"/>
<path d="M58 77 L70 77 L64 84 Z" fill="#6D3D1E"/>
<path d="M64 84 Q60 91 55 89 M64 84 Q68 91 73 89" stroke="#6D3D1E" stroke-width="2" fill="none" stroke-linecap="round"/>"""),
    "koala": ("#E2E8EE", f"""
<circle cx="30" cy="52" r="21" fill="#9AA5B1"/><circle cx="98" cy="52" r="21" fill="#9AA5B1"/>
<circle cx="30" cy="52" r="12" fill="#F2D7DE"/><circle cx="98" cy="52" r="12" fill="#F2D7DE"/>
<circle cx="64" cy="72" r="35" fill="#B0BAC5"/>
<circle cx="50" cy="66" r="4.5" fill="{E}"/><circle cx="78" cy="66" r="4.5" fill="{E}"/>
<ellipse cx="64" cy="80" rx="10" ry="13" fill="#37474F"/>
<path d="M58 96 Q64 100 70 96" stroke="#37474F" stroke-width="2.5" fill="none" stroke-linecap="round"/>"""),
    "puppy": ("#F3E5D8", f"""
<circle cx="64" cy="70" r="36" fill="#E6B98A"/>
<ellipse cx="32" cy="64" rx="12" ry="26" transform="rotate(18 32 64)" fill="#8D5B3A"/>
<ellipse cx="96" cy="64" rx="12" ry="26" transform="rotate(-18 96 64)" fill="#8D5B3A"/>
<circle cx="78" cy="60" r="10" fill="#C9955F"/><ellipse cx="64" cy="86" rx="17" ry="13" fill="#FFF3E6"/>
<circle cx="51" cy="62" r="4.5" fill="{E}"/><circle cx="78" cy="60" r="4.5" fill="{E}"/>
<ellipse cx="64" cy="80" rx="6.5" ry="5" fill="{E}"/>
<path d="M58 88 Q64 93 70 88" stroke="{E}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M61 91 Q64 100 67 91 Z" fill="#EF6F7A"/>"""),
    "tiger": ("#FFE3CC", f"""
<circle cx="38" cy="40" r="13" fill="#F5913E"/><circle cx="90" cy="40" r="13" fill="#F5913E"/>
<circle cx="38" cy="40" r="6" fill="#FFF3E6"/><circle cx="90" cy="40" r="6" fill="#FFF3E6"/>
<circle cx="64" cy="70" r="38" fill="#F5913E"/><path d="M64 32 L60 44 L64 50 L68 44 Z" fill="#3A2418"/>
<path d="M28 64 L42 66 L28 72 Z M100 64 L86 66 L100 72 Z M30 80 L42 80 L32 86 Z M98 80 L86 80 L96 86 Z" fill="#3A2418"/>
<ellipse cx="64" cy="86" rx="20" ry="15" fill="#FFF3E6"/>
<circle cx="50" cy="64" r="4.5" fill="{E}"/><circle cx="78" cy="64" r="4.5" fill="{E}"/>
<path d="M58 79 L70 79 L64 86 Z" fill="#E57373"/>
<path d="M64 86 Q60 92 55 90 M64 86 Q68 92 73 90" stroke="#3A2418" stroke-width="2" fill="none" stroke-linecap="round"/>"""),
}


def render(bg: str, body: str) -> str:
    inner = "".join(line.strip() for line in body.strip().splitlines())
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        f'<circle cx="64" cy="64" r="64" fill="{bg}"/>{inner}</svg>\n'
    )


if __name__ == "__main__":
    for out in OUT_DIRS:
        out.mkdir(parents=True, exist_ok=True)
        for name, (bg, body) in PRESETS.items():
            (out / f"{name}.svg").write_text(render(bg, body), encoding="utf-8")
    print(f"{len(PRESETS)} presets -> {', '.join(str(d.relative_to(ROOT)) for d in OUT_DIRS)}")
