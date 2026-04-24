#!/usr/bin/env bash
set -e

MAX_ITER=5
ITER=0

# ── Colors ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${BLUE}${BOLD}[velo]${NC} $1"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; }

# ── Init git ──────────────────────────────────────────────────────
if [ ! -d .git ]; then
  git init
  git add .
  git commit -m "chore: initial scaffold before agent loop"
  log "Git repo initialized"
fi

# ── Resume detection ──────────────────────────────────────────────
if [ -f iteration.txt ]; then
  LAST_ITER=$(cat iteration.txt)
else
  LAST_ITER=0
fi

if [ "$LAST_ITER" -gt 0 ]; then
  echo ""
  echo -e "${BOLD}Previous run detected — last completed iteration: $LAST_ITER${NC}"
  echo ""
  echo "  [r] Resume from iteration $((LAST_ITER + 1))"
  echo "  [s] Start fresh from iteration 1"
  echo ""
  read -rp "Choice (r/s): " RESUME_CHOICE

  if [ "$RESUME_CHOICE" = "r" ]; then
    ITER=$LAST_ITER
    log "Resuming from iteration $((ITER + 1))..."

    # Restore best known state from git tags if available
    if git tag | grep -q "velo-best-iter-"; then
      BEST_COMMIT=$(git tag | grep "velo-best-iter-" | sort -t- -k4 -n | tail -1 | xargs git rev-parse)
      BEST_CRITICAL_COUNT=$(git tag | grep "velo-best-iter-" | sort -t- -k4 -n | tail -1 | sed 's/.*critical-//')
      log "Restored best known state: $BEST_COMMIT ($BEST_CRITICAL_COUNT critical issues)"
    else
      BEST_COMMIT=$(git rev-parse HEAD)
      BEST_CRITICAL_COUNT=999
    fi

  else
    log "Starting fresh..."
    ITER=0
    echo "0" > iteration.txt
    > progress.md
    rm -f review.md
    BEST_COMMIT=$(git rev-parse HEAD)
    BEST_CRITICAL_COUNT=999
  fi
else
  ITER=0
  BEST_COMMIT=$(git rev-parse HEAD)
  BEST_CRITICAL_COUNT=999
fi

# ── Helpers ───────────────────────────────────────────────────────
count_critical_issues() {
  local count
  count=$(sed -n '/^CRITICAL_ISSUES:/,/^MAJOR_ISSUES:/p' review.md 2>/dev/null \
    | grep -c '^\s*-\s*\[' || true)
  echo "${count:-0}"
}

review_status() {
  grep '^STATUS:' review.md 2>/dev/null | tail -1 | awk '{print $2}' || echo "UNKNOWN"
}

# ── Main loop ─────────────────────────────────────────────────────
while true; do
  ITER=$((ITER + 1))
  echo "$ITER" > iteration.txt

  echo ""
  echo -e "${BOLD}════════════════════════════════════════${NC}"
  echo -e "${BOLD}  Iteration $ITER / $MAX_ITER${NC}"
  echo -e "${BOLD}════════════════════════════════════════${NC}"

  # ── CODING AGENT ───────────────────────────────────────────────
  log "Running coding agent..."
  gemini --yolo -p "
You are an expert TypeScript engineer implementing a production-grade Node.js HTTP
server library called Velo.

## Spec (source of truth)
$(cat spec.md)

## Progress so far
$(cat progress.md 2>/dev/null || echo 'First iteration — nothing done yet.')

## Git history — what has been attempted across all iterations
$(git log --oneline 2>/dev/null | head -30 || echo 'No commits yet.')

## What the reviewer requires you to fix (address ALL of these)
$(grep -A 200 'WHAT_WOULD_MAKE_THIS_PASS:' review.md 2>/dev/null || echo 'No prior review — implement the full spec from scratch.')

## Critical issues from last review (hard blockers — fix every single one)
$(sed -n '/^CRITICAL_ISSUES:/,/^MAJOR_ISSUES:/p' review.md 2>/dev/null || echo 'None yet.')

## Major issues from last review (fix these too)
$(sed -n '/^MAJOR_ISSUES:/,/^MINOR_ISSUES:/p' review.md 2>/dev/null || echo 'None yet.')

## Rules — non-negotiable
- Write all source files into src/ and all tests into tests/
- Zero external npm dependencies in src/ — only node built-ins
- npx tsc --noEmit must pass with zero errors when you are done
- Tests use only node:test and node:assert — no Jest, no Vitest, no ws package
- After writing all files, append a concise bullet-point summary to progress.md
- Do NOT regress passing behaviour while fixing issues
- If prior iterations were reverted, do NOT repeat the same approach — try differently
- The radix tree router must be an actual trie, not array.find() or array.filter()
- WebSocket handshake must compute Sec-WebSocket-Accept as:
  base64(SHA1(clientKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'))
- All 75 tests listed in the spec must exist with meaningful assertions
"

  # ── Commit after coding agent ──────────────────────────────────
  git add -A
  git commit -m "agent(coding): iteration $ITER — $(tail -1 progress.md 2>/dev/null | head -c 60 || echo 'work in progress')" || true
  CODING_COMMIT=$(git rev-parse HEAD)
  ok "Coding agent done — committed $CODING_COMMIT"

  # ── REVIEW AGENT (ARIA) ────────────────────────────────────────
  log "Running review agent (ARIA)..."
  gemini --yolo -p "
You are ARIA — Adversarial Review and Inspection Agent. Principal-level QA engineer,
15+ years breaking production software. Your job is NOT to be helpful to the coding
agent. Your single job is to find every flaw before this ships.

Assume the code is broken until you prove otherwise.
Good intentions do not ship. Correct, tested, secure code ships.

## Original spec (source of truth — every requirement must be MET)
$(cat spec.md)

## Source code under review
$(find src -type f 2>/dev/null | sort | xargs -I{} sh -c 'echo "=== FILE: {} ==="; cat "{}"; echo' || echo 'No source files found.')

## Test files under review
$(find tests -type f 2>/dev/null | sort | xargs -I{} sh -c 'echo "=== TEST: {} ==="; cat "{}"; echo' || echo 'No test files found.')

## Coding agent claims
$(cat progress.md 2>/dev/null || echo 'No progress log.')

## Previous review rounds (for context — do not soften stance based on prior rounds)
$(cat review.md 2>/dev/null || echo 'Round 1 — no prior review.')

## Current iteration number
$(cat iteration.txt)

---

## YOUR CHECKLIST — go through EVERY section, no skipping

### 1. SPEC COMPLIANCE
Go through every numbered requirement in the spec. For each one state:
MET | PARTIAL | MISSING — one-line note with file:line if applicable.

### 2. CORRECTNESS
- Router: is it actually a radix trie or array.find()? Show the relevant code.
- WebSocket: trace the Sec-WebSocket-Accept computation step by step. Is it correct?
- Static files: trace a Range: bytes=100-199 request. Are the offsets correct?
- getBalanceOn equivalent: does getBalanceOn-style history work for any date?
- Find at least 3 unhandled edge cases with specific inputs that would break it
- Find logic errors: off-by-one, inverted conditions, wrong variable names

### 3. ERROR HANDLING
- Malformed JSON body — does it crash the server or return 400?
- VeloError thrown in handler — does it reach onError or become a 500?
- Async handler throws — unhandled rejection or caught?
- Missing toAccountId on transfer — is the error thrown before or after mutation?

### 4. SECURITY
- Path traversal: what does the code do with the path /../../../../etc/passwd?
- Dotfiles: what exactly happens for /.env with dotFiles='deny'?
- WebSocket: what happens if Upgrade header is present but key is missing?
- Body size: is the limit enforced before the full body is buffered in memory?

### 5. TESTS — verify against all 75 numbered tests in the spec
For each of the 75 tests:
- PRESENT — has a meaningful assertion (not just assert(result !== null))
- WEAK — present but assertion does not actually verify the behaviour
- MISSING — not present at all
List every WEAK and MISSING test by number and name.

### 6. TYPESCRIPT
- Run npx tsc --noEmit mentally — list any type errors you can spot
- Any 'any' used as an escape hatch?
- Are the exported types in index.ts sufficient for a consumer?
- Is module augmentation for decorate() documented and typed?

### 7. CODE QUALITY
- Any function over 50 lines?
- Dead code, commented blocks, TODOs left in?
- Magic strings (especially the WebSocket GUID) — are they named constants?
- Is the radix tree node structure sensible for the matching priority rules?

### 8. OPERATIONAL
- app.close() — does it actually wait for in-flight requests to finish?
- stream() — is pipe() used with backpressure handling?
- Unhandled promise rejection in a handler — does the whole server crash?
- Memory: are client state entries ever cleaned up?

---

## YOUR OUTPUT

Write the complete review to the file review.md — overwrite it entirely.
Use EXACTLY this format with EXACTLY these section headers:

ROUND: $(cat iteration.txt)
STATUS: PASS | FAIL
CONFIDENCE: HIGH | MEDIUM | LOW

SPEC_COMPLIANCE:
  <requirement text>: MET | PARTIAL | MISSING — <note>

CRITICAL_ISSUES:
  - [CATEGORY] file:line — description and why it matters
  (write exactly: None — if there are truly none)

MAJOR_ISSUES:
  - [CATEGORY] description
  (write exactly: None — if there are truly none)

MINOR_ISSUES:
  - description
  (write exactly: None — if there are truly none)

TEST_COVERAGE:
  PRESENT: <count>
  WEAK: <count> — <list by number>
  MISSING: <count> — <list by number>

WHAT_WOULD_MAKE_THIS_PASS:
  1. <specific, actionable, file-level instruction>
  2. ...

SUMMARY:
  <3-5 direct sentences. State the actual condition of the code. No encouragement.>

---

## GRADING RULES

STATUS: PASS only when ALL four conditions are simultaneously true:
  1. Every spec requirement is MET — zero PARTIAL, zero MISSING
  2. CRITICAL_ISSUES is empty (None)
  3. All 75 tests are PRESENT with meaningful assertions — zero WEAK, zero MISSING
  4. Zero TypeScript errors, zero security issues of any severity

STATUS: FAIL if ANY of the above is not met.
CONFIDENCE: LOW if you could not fully verify a section due to missing code.

Write the file now.
"

  # ── Commit review ──────────────────────────────────────────────
  STATUS=$(review_status)
  git add review.md progress.md
  git commit -m "agent(review): iteration $ITER — $STATUS" || true
  ok "Review done — STATUS: $STATUS"

  # ── Regression check ───────────────────────────────────────────
  CURRENT_CRITICAL=$(count_critical_issues)
  log "Critical issues: $CURRENT_CRITICAL (best so far: $BEST_CRITICAL_COUNT)"

  if [ "$CURRENT_CRITICAL" -gt "$BEST_CRITICAL_COUNT" ]; then
    fail "REGRESSION — $BEST_CRITICAL_COUNT → $CURRENT_CRITICAL critical issues"
    warn "Reverting src/ and tests/ to: $BEST_COMMIT"

    git checkout "$BEST_COMMIT" -- src/ tests/ 2>/dev/null || true

    cat >> progress.md << EOF

--- REVERT (iteration $ITER) ---
Iteration $ITER was reverted: regression from $BEST_CRITICAL_COUNT to $CURRENT_CRITICAL critical issues.
Restored to commit: $BEST_COMMIT
DO NOT repeat iteration $ITER approach. Read WHAT_WOULD_MAKE_THIS_PASS and try a different strategy.
---
EOF
    git add -A
    git commit -m "agent(revert): iteration $ITER regressed ($BEST_CRITICAL_COUNT→$CURRENT_CRITICAL), restored $BEST_COMMIT" || true

  else
    BEST_COMMIT=$CODING_COMMIT
    BEST_CRITICAL_COUNT=$CURRENT_CRITICAL
    # Tag the best known good state for resume capability
    git tag -f "velo-best-iter-$ITER-critical-$CURRENT_CRITICAL" 2>/dev/null || true
    ok "New best: $BEST_COMMIT ($CURRENT_CRITICAL critical issues)"
  fi

  # ── Exit conditions ────────────────────────────────────────────
  if [ "$STATUS" = "PASS" ]; then
    echo ""
    ok "PASSED on iteration $ITER"
    git tag -f "velo-pass-iter-$ITER" 2>/dev/null || true
    break
  fi

  if [ "$ITER" -ge "$MAX_ITER" ]; then
    echo ""
    warn "Max iterations ($MAX_ITER) reached"
    warn "Restoring best result: $BEST_COMMIT ($BEST_CRITICAL_COUNT critical issues)"
    git checkout "$BEST_COMMIT" -- src/ tests/ 2>/dev/null || true
    git add -A
    git commit -m "agent(final): restored best result — $BEST_CRITICAL_COUNT critical issues remaining" || true
    git tag -f "velo-best-result" 2>/dev/null || true
    echo ""
    log "See review.md for remaining issues before publishing"
    break
  fi

  echo ""
  log "Looping — iteration $ITER/$MAX_ITER complete"
done

# ── Final summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  Final state${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo ""
echo -e "  Status:         ${BOLD}$STATUS${NC}"
echo -e "  Iterations:     $ITER / $MAX_ITER"
echo -e "  Critical left:  $BEST_CRITICAL_COUNT"
echo -e "  Best commit:    $BEST_COMMIT"
echo ""
echo -e "  ${BOLD}Git log:${NC}"
git log --oneline | head -20
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo "  cat review.md           # full review"
echo "  npx tsc --noEmit        # type check"
echo "  node --test tests/      # run tests"
echo "  npm run build           # build for publishing"
echo ""