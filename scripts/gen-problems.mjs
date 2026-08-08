#!/usr/bin/env node
/* =====================================================================
   수리수리 이야기 문제 템플릿 배치 생성기 (로컬 ollama, 무료) — v2 한/영 쌍

   설계: LLM은 "런타임"이 아니라 "오프라인 배치"에서만 사용한다.
   - 생성: qwen3.6 로컬 → 비용 0, 아이에게 실시간 LLM 출력 노출 0
   - 검증: 결정론 코드 (플레이스홀더·연산·길이·금지어) → 통과분만 병합
   - 산출: problems.json 의 storyTemplates 에 append (앱이 자동 로드)

   사용:  node scripts/gen-problems.mjs [개수=10]
   ===================================================================== */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "problems.json");
const MODEL = "qwen3.6:35b-a3b-coding-mxfp8";
const N = Number(process.argv[2] || 10);

const PROMPT = `너는 만 5~6세(한국 나이 7세) 아이를 위한 수학 이야기 문제 템플릿을 만드는 작가야. 각 템플릿은 한국어(ko)와 영어(en) 쌍으로 만든다.

공통 규칙:
- 아이가 "듣고" 이해할 짧고 쉬운 문장 (한 템플릿 = 2~3문장). 숫자를 직접 쓰지 말 것.
- op는 "add"(늘어나는 상황) 또는 "sub"(줄어드는 상황).
- 상황은 일상적·긍정적으로: 간식, 동물, 놀이터, 장난감. 무섭거나 슬픈 상황 금지.
- 마지막 문장은 반드시 질문.

ko 규칙: 플레이스홀더 {name}(아이 이름), {obj}(물건), {a}(처음 수), {b}(변화량). {a},{b} 필수. 60자 이내.
en 규칙: 플레이스홀더 {name}, {aobj}(예: "3 apples"처럼 수+물건이 통째로 들어감), {b}. {aobj},{b} 필수. 아주 쉬운 영어(유치원 수준). 90자 이내.
ko와 en은 같은 상황이어야 한다.

JSON 배열만 출력해. 다른 말 금지:
[{"op":"add","ko":"...","en":"..."}]

${N}개 만들어줘. add와 sub를 섞어서.`;

async function callOllama() {
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      stream: false,
      options: { temperature: 0.9 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.message?.content || "";
}

/* ---------- 결정론 검증 ---------- */
const BANNED_KO = /죽|사라져 버렸|무서|울었|다쳤|병원|피/;
const BANNED_EN = /died|dead|scary|cried|hurt|hospital|blood/i;
function validate(tpl) {
  const errs = [];
  if (!tpl || typeof tpl !== "object") return ["not object"];
  if (!["add", "sub"].includes(tpl.op)) errs.push("bad op");
  const ko = String(tpl.ko || ""), en = String(tpl.en || "");
  // ko
  if (!ko.includes("{a}") || !ko.includes("{b}")) errs.push("ko missing {a}/{b}");
  if (/\d/.test(ko)) errs.push("ko hard-coded digit");
  if (ko.length < 15 || ko.length > 90) errs.push(`ko bad length ${ko.length}`);
  if (!/까요\s*\?|까\s*\?/.test(ko)) errs.push("ko no question");
  if (BANNED_KO.test(ko)) errs.push("ko banned word");
  if (!/[가-힣]/.test(ko)) errs.push("ko not korean");
  // en
  if (!en.includes("{aobj}") || !en.includes("{b}")) errs.push("en missing {aobj}/{b}");
  if (/\d/.test(en)) errs.push("en hard-coded digit");
  if (en.length < 20 || en.length > 130) errs.push(`en bad length ${en.length}`);
  if (!en.trim().endsWith("?")) errs.push("en no question");
  if (BANNED_EN.test(en)) errs.push("en banned word");
  if (/[가-힣]/.test(en)) errs.push("en contains korean");
  return errs;
}

function extractJson(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const main = async () => {
  console.log(`[gen] ${MODEL} 에게 한/영 템플릿 ${N}쌍 요청 중… (로컬, 수 분 걸릴 수 있음)`);
  const raw = await callOllama();
  const arr = extractJson(raw);
  if (!Array.isArray(arr)) {
    console.error("[gen] JSON 배열 파싱 실패. 원문 앞 500자:\n" + raw.slice(0, 500));
    process.exit(1);
  }
  const bank = JSON.parse(readFileSync(OUT, "utf8"));
  // v1 형식 {op,t} → {op,ko} 마이그레이션
  bank.storyTemplates = (bank.storyTemplates || []).map(x => x.t ? { op: x.op, ko: x.t } : x);
  const existing = new Set(bank.storyTemplates.map(x => x.ko));
  let ok = 0, dup = 0, bad = 0;
  for (const tpl of arr) {
    const errs = validate(tpl);
    if (errs.length) { bad++; console.log(`  ✗ [${errs.join(",")}] ${JSON.stringify(tpl).slice(0, 90)}`); continue; }
    if (existing.has(tpl.ko)) { dup++; continue; }
    existing.add(tpl.ko);
    bank.storyTemplates.push({ op: tpl.op, ko: tpl.ko, en: tpl.en });
    ok++;
    console.log(`  ✓ [${tpl.op}] ${tpl.ko}`);
    console.log(`         ${tpl.en}`);
  }
  bank.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(bank, null, 2));
  console.log(`[gen] 완료: 신규 ${ok} · 중복 ${dup} · 탈락 ${bad} → 총 ${bank.storyTemplates.length}개 (problems.json)`);
};
main().catch(e => { console.error("[gen] 실패:", e.message); process.exit(1); });
