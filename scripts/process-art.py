#!/usr/bin/env python3
"""업로드된 캐릭터 시트 → 앱 스킨 PNG 생성.
- 표정 시트(5x3): 셀 크롭 → 코너 플러드필로 배경 제거 → bbox 트림 → 정사각 512
- 알 이미지: 타원 마스크 + 가장자리 페더링
사용: python3 scripts/process-art.py <시트> <알이미지> <출력디렉토리>
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

sheet_path, egg_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]

# (행,열) → 파일명 (앱 상태 + 확장 표정)
GRID = {
    (0,0): "idle",      # 기쁨
    (0,1): "happy",     # 행복
    (0,2): "love",      # 사랑해
    (0,3): "sad",       # 슬픔
    (0,4): "angry",     # 화남
    (1,0): "surprised", # 놀람
    (1,1): "hungry",    # 배고픔
    (1,2): "sick",      # 아픔
    (1,3): "sleepy",    # 졸림
    (1,4): "sleep",     # 꿀잠
    (2,0): "bored",     # 심심함
    (2,1): "curious",   # 궁금해
    (2,2): "proud",     # 뿌듯해
    (2,3): "shy",       # 부끄러워
    (2,4): "excited",   # 신나요
}
ROWS = [(95, 350), (410, 655), (705, 955)]  # 라벨 pill 제외한 스프라이트 밴드

def remove_bg(im, thresh=45):
    im = im.convert("RGBA")
    w, h = im.size
    marker = (255, 0, 255, 255)
    for corner in [(0,0), (w-1,0), (0,h-1), (w-1,h-1)]:
        try:
            ImageDraw.floodfill(im, corner, marker, thresh=thresh)
        except Exception:
            pass
    px = im.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == (255, 0, 255):
                px[x, y] = (0, 0, 0, 0)
    return im

def trim_square(im, size=512, pad_ratio=0.06):
    bbox = im.getbbox()
    if not bbox:
        return None
    im = im.crop(bbox)
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas.resize((size, size), Image.LANCZOS)

sheet = Image.open(sheet_path)
W, H = sheet.size
colw = W / 5
made = []
for (r, c), name in GRID.items():
    y0, y1 = ROWS[r]
    cell = sheet.crop((int(c * colw), y0, int((c + 1) * colw), y1))
    cut = remove_bg(cell)
    sq = trim_square(cut)
    if sq is None:
        print(f"  ✗ {name}: 내용 없음"); continue
    out = f"{outdir}/owl_{name}.png"
    sq.save(out)
    made.append(name)
    print(f"  ✓ owl_{name}.png")

# 알: 타원 마스크 + 페더
egg = Image.open(egg_path).convert("RGBA")
mask = Image.new("L", egg.size, 0)
d = ImageDraw.Draw(mask)
d.ellipse((300, 200, 965, 1010), fill=255)  # 알 영역
mask = mask.filter(ImageFilter.GaussianBlur(6))
egg.putalpha(mask)
sq = trim_square(egg)
sq.save(f"{outdir}/owl_egg.png")
print("  ✓ owl_egg.png")
print(f"완료: {len(made)+1}개")
