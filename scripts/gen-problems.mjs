#!/usr/bin/env node
/* =====================================================================
   수리수리 이야기 문제 템플릿 배치 생성기 (로컬 ollama, 무료)

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

const PROMPT = `너는 만 5~6세(한국 나이 7세) 아이를 위한 수학 이야기 문제 템플릿을 만드는 작가야.

규칙:
- 한국어. 아이가 "듣고" 이해할 짧고 쉬운 문장 (한 템플릿 = 2~3문장, 60자 이내).
- 반드시 플레이스홀더 사용: {name}=아이 이름, {obj}=물건 이름, {a}=처음 수, {b}=변화량. ({name}과 {obj}는 상황에 따라 생략 가능하지만 {a},{b}는 필수)
- 숫자를 직접 쓰지 말 것. 오직 {a},{b}만.
- op는 "add"(늘어나는 상황) 또는 "sub"(줄어드는 상황).
- 상황은 일상적·긍정적으로: 간식, 동물, 놀이터, 장난감. 무섭거나 슬픈 상황 금지.
- 마지막 문장은 반드시 "몇 개일까요?" / "몇 마리 남았을까요?" 같은 질문.

JSON 배열만 출력해. 다른 말 금지:
[{"op":"add","t":"..."},{"op":"sub","t":"..."}]

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
const BANNED = /죽|사라져 버렸|무서|울었|다쳤|병원|피/;
function validate(tpl) {
  const errs = [];
  if (!tpl || typeof tpl !== "object") return ["not object"];
  if (!["add", "sub"].includes(tpl.op)) errs.push("bad op");
  const t = String(tpl.t || "");
  if (!t.includes("{a}") || !t.includes("{b}")) errs.push("missing {a}/{b}");
  if (/\d/.test(t)) errs.push("hard-coded digit");
  if (t.length < 15 || t.length > 90) errs.push(`bad length ${t.length}`);
  if (!/까요\s*\?|까\s*\?/.test(t)) errs.push("no question ending");
  if (BANNED.test(t)) errs.push("banned word");
  if (!/[가-힣]/.test(t)) errs.push("not korean");
  return errs;
}

function extractJson(text) {
  // 모델이 <think>나 잡담을 섞어도 첫 JSON 배열만 추출
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const main = async () => {
  console.log(`[gen] ${MODEL} 에게 템플릿 ${N}개 요청 중… (로컬, 수 분 걸릴 수 있음)`);
  const raw = await callOllama();
  const arr = extractJson(raw);
  if (!Array.isArray(arr)) {
    console.error("[gen] JSON 배열 파싱 실패. 원문 앞 500자:\n" + raw.slice(0, 500));
    process.exit(1);
  }
  const bank = JSON.parse(readFileSync(OUT, "utf8"));
  const existing = new Set((bank.storyTemplates || []).map(x => x.t));
  let ok = 0, dup = 0, bad = 0;
  for (const tpl of arr) {
    const errs = validate(tpl);
    if (errs.length) { bad++; console.log(`  ✗ [${errs.join(",")}] ${JSON.stringify(tpl).slice(0, 80)}`); continue; }
    if (existing.has(tpl.t)) { dup++; continue; }
    existing.add(tpl.t);
    bank.storyTemplates.push({ op: tpl.op, t: tpl.t });
    ok++;
    console.log(`  ✓ [${tpl.op}] ${tpl.t}`);
  }
  bank.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(bank, null, 2));
  console.log(`[gen] 완료: 신규 ${ok} · 중복 ${dup} · 탈락 ${bad} → 총 ${bank.storyTemplates.length}개 (problems.json)`);
};
main().catch(e => { console.error("[gen] 실패:", e.message); process.exit(1); });
