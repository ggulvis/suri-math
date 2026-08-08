#!/usr/bin/env node
/* =====================================================================
   수리수리 펫 대사 배치 생성기 (로컬 ollama, 무료)
   - 종(6) × 종류(greet/happy/hungry/sleepy/praise) 대사를 성격에 맞게 생성
   - 결정론 검증(길이·금지어·{child} 사용) 통과분만 dialogue.json에 병합
   사용: node scripts/gen-dialogue.mjs [종당 종류별 개수=4]
   ===================================================================== */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dialogue.json");
const MODEL = "qwen3.6:35b-a3b-coding-mxfp8";
const PER = Number(process.argv[2] || 4);

const CHARS = {
  owl: "수리(부엉이) — 다정하고 지혜로운 선생님 같은 친구. 따뜻하고 차분한 말투",
  dino: "디노(공룡) — 씩씩하고 에너지 넘치는 장난꾸러기. '크앙' 같은 소리를 냄",
  cat: "나비(고양이) — 새침하지만 사실은 다정함. '야옹', 츤데레 말투",
  penguin: "펭펭(펭귄) — 겁이 많지만 성실하고 용기를 내는 친구. '펭펭', 뒤뚱뒤뚱",
  dragon: "드래곤 — 허세 부리는 꼬마 용사. '전설', '위대한' 같은 과장 표현을 좋아함",
  unicorn: "유니(유니콘) — 꿈꾸는 낭만파. 무지개·별·반짝임 표현을 좋아함",
};
const KINDS = {
  greet: "아이를 만났을 때 인사",
  happy: "기분이 좋을 때",
  hungry: "배고플 때 (부드럽게, 조르지만 슬프지 않게)",
  sleepy: "졸릴 때/밤 인사",
  praise: "아이가 수학 문제를 맞혔을 때 칭찬",
};
const BANNED = /죽|무서|싫어|미워|바보|멍청|때리|아파서 울|병원|피|짜증/;

function prompt(spKey) {
  return `너는 만 5~6세 아이의 다마고치 친구 캐릭터 대사를 쓰는 작가야.
캐릭터: ${CHARS[spKey]}

대사 규칙:
- 반말, 한 문장 또는 짧은 두 문장 (8~40자).
- 아이 이름 자리에 반드시는 아니지만 자주 {child} 를 넣어 (예: "{child}, 안녕!"). 전체의 절반 이상은 {child} 포함.
- 무섭거나 슬프거나 죄책감 주는 표현 금지. 항상 다정하고 유쾌하게.
- 캐릭터 말버릇을 살려.

다음 5가지 상황별로 각 ${PER}개씩 만들어. JSON만 출력:
{"greet":["..."],"happy":["..."],"hungry":["..."],"sleepy":["..."],"praise":["..."]}
상황: ${Object.entries(KINDS).map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

async function callOllama(p) {
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: p }], stream: false, options: { temperature: 1.0 } }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  return (await res.json()).message?.content || "";
}
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function validLine(l) {
  if (typeof l !== "string") return false;
  const t = l.trim();
  return t.length >= 6 && t.length <= 50 && !BANNED.test(t) && /[가-힣]/.test(t) && !/\d/.test(t);
}

const main = async () => {
  const bank = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  let total = 0, bad = 0;
  for (const sp of Object.keys(CHARS)) {
    console.log(`[gen] ${sp} 대사 생성 중…`);
    const raw = await callOllama(prompt(sp));
    const obj = extractJson(raw);
    if (!obj) { console.log(`  ✗ ${sp}: JSON 파싱 실패`); continue; }
    bank[sp] = bank[sp] || {};
    for (const kind of Object.keys(KINDS)) {
      const lines = (obj[kind] || []).filter(validLine);
      bad += (obj[kind] || []).length - lines.length;
      const cur = new Set(bank[sp][kind] || []);
      for (const l of lines) cur.add(l.trim());
      bank[sp][kind] = [...cur];
      total += lines.length;
      lines.forEach(l => console.log(`  ✓ [${kind}] ${l}`));
    }
  }
  writeFileSync(OUT, JSON.stringify(bank, null, 2));
  const count = Object.values(bank).reduce((a, sp) => a + Object.values(sp).reduce((x, ls) => x + ls.length, 0), 0);
  console.log(`[gen] 완료: 신규 ${total} · 탈락 ${bad} → 뱅크 총 ${count}개 (dialogue.json)`);
};
main().catch(e => { console.error("[gen] 실패:", e.message); process.exit(1); });
