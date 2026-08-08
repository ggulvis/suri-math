#!/usr/bin/env node
/* =====================================================================
   수리수리 음성 사전 렌더링 (edge-tts 신경망 TTS — 무료)

   왜: iOS Web Speech는 기기 내장 음성이 상한이고, 시리 음성은 애플이 안 열어준다.
       고정 문장(대사·피드백)은 미리 구워서 재생하면 품질 상한이 사라진다.

   대상: 펫 대사(내장 BABY/TODDLER/PERSONA + dialogue.json) + 고정 피드백
   제외: 문제 낭독(숫자·이름이 매번 달라 조합 불가) → 런타임 합성 유지

   산출: assets/voice/NNNN.mp3 + assets/voice/manifest.json {문장: 파일}
   앱 동작: manifest에 있으면 오디오 재생, 없으면 speechSynthesis 폴백

   사용:
     node scripts/render-voice.mjs                 # {child} → "친구"로 렌더
     node scripts/render-voice.mjs --name 지우      # 실제 이름을 넣어 렌더
   ===================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = join(ROOT, "assets", "voice");
const EDGE = "/private/tmp/claude-502/-Users-openclaw/2fdc7299-621a-4de9-8e4e-f6e9956c7a3d/scratchpad/ttsenv/bin/edge-tts";
const VOICE = "ko-KR-SunHiNeural";
const CONCURRENCY = 4;

const nameArg = (() => {
  const i = process.argv.indexOf("--name");
  return i > 0 ? process.argv[i + 1] : null;
})();

/* 한국어 조사·호격 (앱과 동일 규칙) */
const hasJong = w => { const c = w.charCodeAt(w.length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 > 0; };
const voc = n => n ? n + (hasJong(n) ? "아" : "야") : "친구야";
const bare = n => n ? n + (hasJong(n) ? "이" : "") : "친구";
function fillChild(t, nm) {
  return t.replace(/\{child\}[야아]/g, voc(nm))
          .replace(/\{child\}(?=[,!?.…~]|$)/g, voc(nm))
          .replace(/\{child\}/g, bare(nm));
}

/* index.html에서 대사 뱅크 추출 (앱이 유일한 원본) */
function extractBank(html, varName) {
  const start = html.indexOf(`const ${varName} = {`);
  if (start < 0) return {};
  let i = html.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  const src = html.slice(i, end);
  return Function(`"use strict";return (${src});`)();
}

/* 톤 프로파일: 성장 단계별로 목소리 높이를 다르게 굽는다 */
const TONE = {
  narration: { pitch: "+0Hz",  rate: "-8%"  },  // 선생님 목소리(피드백·안내)
  adult:     { pitch: "+10Hz", rate: "-4%"  },  // 성체 펫
  toddler:   { pitch: "+28Hz", rate: "-6%"  },  // 유아 펫
  baby:      { pitch: "+45Hz", rate: "-10%" },  // 아기 옹알이
};

/* 고정 피드백·안내 (index.html의 speak() 리터럴과 일치해야 함) */
const FEEDBACK = [
  "딩동댕! 정답이에요!", "우와, 맞았어요!", "정답! 최고예요!", "그렇죠! 이제 맞았어요!",
  "괜찮아요! 그림을 하나씩 누르면서 같이 세어 볼까요?",
  "음, 다시 한 번! 하나씩 짝지어 세어 보세요!",
  "이쪽이 더 많았어요! 다음에 다시 해 봐요!",
  "음, 잘 못 알아봤어요. 조금 더 크게 써 줄래요?",
  "완벽해요! 모두 맞혔어요! ", "오늘의 모험 완료! 정말 잘했어요! ",
  "안녕하세요! 이 목소리로 읽어 드릴게요.",
  "안녕하세요! 사과가 세 개, 딸기가 두 개 있어요. 모두 몇 개일까요?",
  "알이 꿈틀꿈틀!", "냠냠! 알이 따뜻해졌어요!",
  "약 먹었더니 다 나았어요! 정말 고마워요!",
  "잘 자요… 내일 만나요…", "잘 잤어요! 푹 재워 줘서 고마워요!",
];

const main = async () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const BABY = extractBank(html, "BABY");
  const TODDLER = extractBank(html, "TODDLER");
  const PERSONA = extractBank(html, "PERSONA");
  const extra = existsSync(join(ROOT, "dialogue.json"))
    ? JSON.parse(readFileSync(join(ROOT, "dialogue.json"), "utf8")) : {};

  /* 수집: {text, tone} — 중복 제거 */
  const jobs = new Map();
  const add = (raw, tone) => {
    const t = fillChild(String(raw).trim(), nameArg);
    if (!t) return;
    if (!jobs.has(t)) jobs.set(t, tone);
  };
  FEEDBACK.forEach(t => add(t, "narration"));
  Object.values(BABY).flat().forEach(t => add(t, "baby"));
  Object.values(TODDLER).flat().forEach(t => add(t, "toddler"));
  for (const sp of Object.values(PERSONA)) Object.values(sp).flat().forEach(t => add(t, "adult"));
  for (const sp of Object.values(extra)) {
    if (!sp || typeof sp !== "object") continue;
    for (const lines of Object.values(sp)) {
      if (Array.isArray(lines)) lines.forEach(t => add(t, "adult"));
    }
  }

  mkdirSync(OUTDIR, { recursive: true });
  // 이전 산출물 정리 (이름 변경 시 잔여물 방지)
  if (existsSync(OUTDIR)) for (const f of readdirSync(OUTDIR)) unlinkSync(join(OUTDIR, f));

  const entries = [...jobs.entries()];
  console.log(`[voice] ${VOICE} · ${entries.length}개 문장 렌더링 시작` + (nameArg ? ` (이름: ${nameArg})` : " (이름: 친구)"));

  const manifest = {};
  let done = 0, failed = 0;
  const renderOne = async ([text, tone], idx) => {
    const file = String(idx + 1).padStart(4, "0") + ".mp3";
    const { pitch, rate } = TONE[tone];
    try {
      await run(EDGE, ["--voice", VOICE, "--pitch", pitch, "--rate", rate,
                       "--text", text, "--write-media", join(OUTDIR, file)], { timeout: 60000 });
      manifest[text] = file;
      done++;
      if (done % 20 === 0) console.log(`  … ${done}/${entries.length}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ [${tone}] ${text.slice(0, 30)} — ${e.message.split("\n")[0]}`);
    }
  };
  // 제한 병렬 (TTS 서버 배려)
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(entries.slice(i, i + CONCURRENCY).map((e, k) => renderOne(e, i + k)));
  }

  writeFileSync(join(OUTDIR, "manifest.json"), JSON.stringify({
    voice: VOICE, name: nameArg || null, count: Object.keys(manifest).length, files: manifest,
  }, null, 1));
  const bytes = readdirSync(OUTDIR).reduce((a, f) => a + Buffer.byteLength(readFileSync(join(OUTDIR, f))), 0);
  console.log(`[voice] 완료: 성공 ${done} · 실패 ${failed} · 총 ${(bytes / 1048576).toFixed(1)}MB → assets/voice/`);
};
main().catch(e => { console.error("[voice] 실패:", e.message); process.exit(1); });
