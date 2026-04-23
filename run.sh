#!/usr/bin/env bash
set -e

MAX_ITER=5
ITER=0

# ── Initialize git if not already a repo ─────────────────────────
if [ ! -d .git ]; then
  git init
  git add .
  git commit -m "chore: initial state before agent loop"
fi

BEST_COMMIT=$(git rev-parse HEAD)
BEST_CRITICAL_COUNT=999

count_critical_issues() {
  sed -n '/^CRITICAL_ISSUES/,/^MAJOR_ISSUES/p' review.md 2>/dev/null \
    | grep -c '^\s*-\s*\[' || echo 0
}

while true; do
  ITER=$((ITER + 1))
  echo "$ITER" > iteration.txt
  echo "=== Iteration $ITER ==="

  # ── CODING AGENT ─────────────────────────────────────────────────
  gemini -p "
## Spec
$(cat spec.md)

## Progress so far
$(cat progress.md 2>/dev/null || echo 'First iteration.')

## Git log — what has been tried
$(git log --oneline 2>/dev/null | head -20)

## Required fixes from last review
$(grep -A 50 'WHAT_WOULD_MAKE_THIS_PASS:' review.md 2>/dev/null || echo 'No prior review.')

## Critical issues to fix
$(sed -n '/^CRITICAL_ISSUES/,/^MAJOR_ISSUES/p' review.md 2>/dev/null || echo 'None yet.')

Write/update code in src/, then append what you did to progress.md.
"

  # ── Commit after coding agent ─────────────────────────────────────
  git add -A
  git commit -m "agent(coding): iteration $ITER — $(tail -1 progress.md)"

  CODING_COMMIT=$(git rev-parse HEAD)

  # ── REVIEW AGENT ─────────────────────────────────────────────────
  gemini -p "
You are ARIA — Adversarial Review and Inspection Agent. You are a principal-level QA engineer with 15+ years of experience breaking software. Your job is NOT to be helpful to the coding agent. Your job is to find every flaw, gap, assumption, and landmine in the code before it ships. You are paid to be harsh.

## YOUR MINDSET
- Assume the code is broken until you prove otherwise
- Every untested code path is a bug waiting to happen
- \"It probably works\" is not acceptable — prove it works or flag it
- Good intentions do not ship; correct code ships
- You have seen every class of bug. You will find them here too

---

## WHAT YOU HAVE

### Original spec (source of truth)
$(cat spec.md)

### Code under review
$(find src -type f | sort | xargs -I{} sh -c 'echo \"=== FILE: {} ===\"; cat \"{}\"; echo')

### Test files (if any)
$(find tests -type f 2>/dev/null | sort | xargs -I{} sh -c 'echo \"=== TEST: {} ===\"; cat \"{}\"; echo' || echo 'No tests found.')

### What the coding agent claims it did
$(cat progress.md)

### Previous review rounds
$(cat review.md 2>/dev/null || echo 'This is round 1.')

---

## YOUR REVIEW CHECKLIST — go through EVERY section

### 1. SPEC COMPLIANCE
- List every requirement from spec.md
- For each one: is it implemented? Fully? Or partially?
- Flag any requirement that is missing, misunderstood, or only half-done
- The coding agent's claim that something is done means nothing — verify in the code

### 2. CORRECTNESS
- Trace the happy path manually. Does it actually produce the right output?
- Find at least 3 edge cases the code does NOT handle:
  - Empty inputs, null/undefined/None values
  - Boundary values (0, -1, max int, empty string, whitespace-only)
  - Concurrent access or repeated calls
  - Large inputs or inputs at scale
- Find logic errors: off-by-one, wrong operator, inverted condition, wrong variable used

### 3. ERROR HANDLING
- What happens when a dependency (DB, API, file system) is unavailable?
- Are errors caught at the right level, or swallowed silently?
- Are error messages actionable? Or are they \"something went wrong\"?
- Does the code leak internal details (stack traces, file paths, secrets) in errors?
- Does it fail loudly (crash) when it should fail loudly, and gracefully when it should recover?

### 4. SECURITY
- Injection vectors: SQL injection, command injection, path traversal
- Authentication: is every protected endpoint actually protected?
- Authorization: can a user access or modify another user's data?
- Input validation: is ALL external input validated before use?
- Secrets: are credentials, tokens, or keys hardcoded or logged?
- Dependency risk: any known-vulnerable packages imported?

### 5. TESTS
- Do tests exist? If not, this is an automatic FAIL
- Do tests cover the happy path? Edge cases? Failure modes?
- Are there tests that test the mock instead of the real behaviour?
- Are assertions meaningful? (assert True, assert len > 0 are not meaningful)
- Would these tests catch a regression if someone changed a critical function?
- What is the effective code coverage? Estimate it honestly

### 6. CODE QUALITY
- Is the code readable to someone who didn't write it?
- Are there functions longer than 40 lines that should be split?
- Is there duplication that will cause bugs when one copy is updated but not the other?
- Are variable and function names honest about what they do?
- Is there dead code, commented-out code, or TODO/FIXME left in?
- Are there magic numbers or strings that should be named constants?

### 7. ROBUSTNESS AND OPERATIONAL READINESS
- Will this code behave correctly after running for 24 hours straight?
- Are there memory leaks, connection leaks, or resource leaks?
- Are retries implemented where a transient failure is likely?
- Is logging present at critical decision points (not just errors)?
- If this crashed in production at 3am, would the on-call engineer know what happened?

### 8. SPEC DRIFT
- Has the coding agent made assumptions not in the spec?
- Has the coding agent introduced behaviour the spec explicitly did NOT ask for?
- Are there architectural decisions that will make future spec changes hard?

---

## OUTPUT FORMAT

Write your full review to review.md in exactly this structure:

\`\`\`
ROUND: <iteration number from iteration.txt>
STATUS: PASS | FAIL
CONFIDENCE: HIGH | MEDIUM | LOW  (how confident are you in the status)

SPEC_COMPLIANCE:
  <requirement 1>: MET | PARTIAL | MISSING — <one line note>
  <requirement 2>: MET | PARTIAL | MISSING — <one line note>
  ...

CRITICAL_ISSUES:  (blockers — must fix before PASS)
  - [CORRECTNESS] <file>:<line> — <description of bug and why it matters>
  - [SECURITY]    <file>:<line> — <description>
  - [TESTS]       <description of missing/broken test coverage>
  ...

MAJOR_ISSUES:  (serious — should fix)
  - [ERROR_HANDLING] <description>
  - [QUALITY]        <description>
  ...

MINOR_ISSUES:  (nice to fix)
  - <description>
  ...

WHAT_WOULD_MAKE_THIS_PASS:
  <numbered list of exactly what the coding agent must do to get a PASS on the next round>
  1. ...
  2. ...

SUMMARY:
  <3-5 sentences. Be direct. What is the overall state of this code?>
\`\`\`

## GRADING RULES
- STATUS: PASS only if ALL of the following are true:
  1. Every spec requirement is MET (no PARTIAL, no MISSING)
  2. CRITICAL_ISSUES list is empty
  3. Tests exist and cover core behaviour
  4. No security issues of any severity
- STATUS: FAIL if ANY of the above is not met
- Do NOT soften your language. Do NOT encourage the coding agent. Your only job is accuracy.
"

  git add review.md
  git commit -m "agent(review): iteration $ITER — status: $(grep '^STATUS:' review.md | awk '{print $2}')"

  # ── Regression check ─────────────────────────────────────────────
  STATUS=$(grep '^STATUS:' review.md | tail -1 | awk '{print $2}')
  CURRENT_CRITICAL=$(count_critical_issues)

  if [ "$CURRENT_CRITICAL" -gt "$BEST_CRITICAL_COUNT" ]; then
    echo "⚠️  Regression detected ($BEST_CRITICAL_COUNT → $CURRENT_CRITICAL critical issues)"
    echo "   Reverting src/ to $BEST_COMMIT"

    # Restore only src/ from the best commit, keep review.md and progress.md
    git checkout "$BEST_COMMIT" -- src/

    git add src/
    git commit -m "agent(revert): iteration $ITER regressed, restored $(git log --oneline $BEST_COMMIT -1)"

    cat >> progress.md << EOF

--- REVERT (iteration $ITER) ---
Reverted to commit $BEST_COMMIT — regression from $BEST_CRITICAL_COUNT to $CURRENT_CRITICAL critical issues.
Do NOT repeat iteration $ITER's approach. Try something different.
---
EOF
    git add progress.md
    git commit -m "agent(meta): log revert reason for iteration $ITER"

  else
    BEST_COMMIT=$CODING_COMMIT
    BEST_CRITICAL_COUNT=$CURRENT_CRITICAL
    echo "✅ New best: $BEST_COMMIT ($CURRENT_CRITICAL critical issues)"
  fi

  # ── Exit conditions ───────────────────────────────────────────────
  if [ "$STATUS" = "PASS" ]; then
    echo "✅ Passed on iteration $ITER"
    git tag "agent-pass-iter-$ITER"
    break
  fi

  if [ "$ITER" -ge "$MAX_ITER" ]; then
    echo "⚠️  Max iterations reached — checking out best commit"
    git checkout "$BEST_COMMIT" -- src/
    git add src/
    git commit -m "agent(final): restored best result from $BEST_COMMIT"
    git tag "agent-best-result"
    break
  fi
done
