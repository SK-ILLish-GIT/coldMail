import { nanoid } from 'nanoid';

import { parseResume } from './texParser.js';
import { computeScores } from './scorer.js';
import { generateSuggestions, refineSuggestion } from './gemini.js';
import { applySuggestion, rollbackAll } from './texEditor.js';

const TTL_MS = 60 * 60 * 1000; // 1 hour
const sessions = new Map();

function evictExpired() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (s.expiresAt < now) sessions.delete(id);
  }
}

function touch(session) {
  session.expiresAt = Date.now() + TTL_MS;
}

function publicSuggestion(s) {
  if (!s) return null;
  return {
    id: s.id,
    section: s.section,
    subheading: s.subheading,
    action: s.action,
    targetBulletText: s.targetBulletText,
    targetSkillsCategory: s.targetSkillsCategory,
    draftLatex: s.draftLatex,
    previewText: s.previewText,
    reason: s.reason,
    atsKeywords: s.atsKeywords,
    impact: s.impact,
    status: s.status,
  };
}

function publicState(session) {
  return {
    sessionId: session.id,
    cvRoot: session.cvRoot,
    initialScores: session.initialScores,
    currentScores: session.currentScores,
    pending: session.queue.filter((q) => q.status === 'pending').length,
    applied: session.queue.filter((q) => q.status === 'approved').length,
    totalSuggestions: session.totalSuggestions,
    targetCompany: session.targetCompany,
    targetRole: session.targetRole,
    seniority: session.seniority,
    tone: session.tone,
  };
}

function nextPending(session) {
  return session.queue.find((s) => s.status === 'pending') || null;
}

/**
 * Create a new tailoring session. Parses the resume, computes initial scores,
 * asks Gemini for the suggestion plan, and queues up suggestions.
 */
export async function createSession({
  cvRoot,
  jobDescription,
  targetRole = '',
  targetCompany = '',
  seniority = '',
  tone = '',
}) {
  evictExpired();
  if (!cvRoot) throw new Error('cvRoot is required.');
  if (!jobDescription || !jobDescription.trim()) {
    throw new Error('jobDescription is required.');
  }

  const parsed = await parseResume(cvRoot);
  const initialScores = computeScores(parsed, jobDescription);

  const ai = await generateSuggestions(parsed, {
    jobDescription,
    targetRole,
    targetCompany,
    seniority,
    tone,
  });

  const queue = ai.suggestions.map((s) => ({
    ...s,
    id: nanoid(8),
    status: 'pending',
  }));

  const id = nanoid(12);
  const session = {
    id,
    cvRoot,
    parsed,
    jobDescription,
    targetRole,
    targetCompany,
    seniority,
    tone,
    initialScores,
    currentScores: initialScores,
    queue,
    totalSuggestions: queue.length,
    changeLog: [],
    touchedFiles: new Set(),
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(id, session);
  return {
    ...publicState(session),
    firstSuggestion: publicSuggestion(nextPending(session)),
  };
}

export function getSession(id) {
  evictExpired();
  return sessions.get(id) || null;
}

export function nextSuggestion(id) {
  const s = getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  touch(s);
  const np = nextPending(s);
  if (!np) {
    return { done: true, state: publicState(s) };
  }
  return { done: false, suggestion: publicSuggestion(np), state: publicState(s) };
}

// Roll the session's files back to their .bak baseline, reparse, then
// re-apply every queue entry currently marked 'approved' in queue order.
// Used whenever a previously-decided suggestion is re-decided (rejected,
// re-edited, re-approved): we always rebuild from baseline so the on-disk
// state stays in sync with the queue, no matter how many times the user
// flip-flops.
async function replayApprovedQueue(s) {
  await rollbackAll(s.touchedFiles);
  s.parsed = await parseResume(s.cvRoot);
  for (const q of s.queue) {
    if (q.status !== 'approved') continue;
    try {
      await applySuggestion(s.parsed, q, s.touchedFiles);
    } catch (err) {
      // A previously-approved suggestion may no longer fit (e.g. the user
      // edited an earlier one that changed the target text). Mark it failed
      // and keep going so the rest of the approved queue still lands.
      q.status = 'failed';
      q.error = err.message;
    }
  }
  s.currentScores = computeScores(s.parsed, s.jobDescription);
}

function logEntry(action, sug, extra = {}) {
  return {
    at: new Date().toISOString(),
    action,
    suggestionId: sug.id,
    section: sug.section,
    preview: sug.previewText,
    ...extra,
  };
}

export async function decideSuggestion(id, { suggestionId, decision, editInstruction }) {
  const s = getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  touch(s);
  const sug = s.queue.find((q) => q.id === suggestionId);
  if (!sug) throw httpErr(404, 'Suggestion not found in session.');
  const wasApproved = sug.status === 'approved';
  const respond = (extra) => ({
    next: publicSuggestion(nextPending(s)),
    state: publicState(s),
    ...extra,
  });

  if (decision === 'reject' || decision === 'skip') {
    if (sug.status === 'rejected') {
      return respond({ result: 'rejected' });
    }
    sug.status = 'rejected';
    s.changeLog.push(logEntry('reject', sug));
    if (wasApproved) await replayApprovedQueue(s);
    return respond({ result: 'rejected' });
  }

  if (decision === 'edit') {
    if (!editInstruction || !editInstruction.trim()) {
      throw httpErr(400, 'editInstruction is required for decision=edit.');
    }
    const refined = await refineSuggestion({ original: sug, instruction: editInstruction });
    sug.draftLatex = refined.draftLatex;
    sug.previewText = refined.previewText;
    if (refined.reason) sug.reason = refined.reason;
    if (wasApproved) {
      // Re-apply with the refined content so disk matches the new draft.
      await replayApprovedQueue(s);
      s.changeLog.push(logEntry('re-edit', sug));
      return { result: 'refined-applied', next: publicSuggestion(sug), state: publicState(s) };
    }
    sug.status = 'pending';
    return { result: 'refined', next: publicSuggestion(sug), state: publicState(s) };
  }

  if (decision === 'approve') {
    if (wasApproved) {
      return respond({ result: 'noop' });
    }
    if (sug.status === 'pending') {
      // Fast path: apply directly without a full replay.
      try {
        const change = await applySuggestion(s.parsed, sug, s.touchedFiles);
        sug.status = 'approved';
        s.changeLog.push(
          logEntry('approve', sug, { file: change.file, opAction: change.action })
        );
        s.currentScores = computeScores(s.parsed, s.jobDescription);
        return respond({ result: 'applied', change });
      } catch (err) {
        sug.status = 'failed';
        sug.error = err.message;
        s.changeLog.push(logEntry('failed', sug, { error: err.message }));
        return respond({ result: 'failed', error: err.message });
      }
    }
    // Re-approving a previously rejected/failed suggestion: do a full replay
    // so it lands consistently with everything else still approved.
    sug.status = 'approved';
    try {
      await replayApprovedQueue(s);
      // If replayApprovedQueue marked our own suggestion as failed, surface that.
      if (sug.status === 'failed') {
        s.changeLog.push(logEntry('failed', sug, { error: sug.error }));
        return respond({ result: 'failed', error: sug.error });
      }
      s.changeLog.push(logEntry('approve', sug, { opAction: sug.action }));
      return respond({ result: 'applied' });
    } catch (err) {
      sug.status = 'failed';
      sug.error = err.message;
      s.changeLog.push(logEntry('failed', sug, { error: err.message }));
      return respond({ result: 'failed', error: err.message });
    }
  }

  throw httpErr(400, `Unknown decision "${decision}".`);
}

export async function rollbackSession(id) {
  const s = getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  touch(s);
  const restored = await rollbackAll(s.touchedFiles);
  s.parsed = await parseResume(s.cvRoot);
  s.currentScores = computeScores(s.parsed, s.jobDescription);
  s.changeLog.push({
    at: new Date().toISOString(),
    action: 'rollback',
    restoredFiles: restored.length,
  });
  // Mark any approved suggestions as pending again so the user can re-run.
  for (const q of s.queue) {
    if (q.status === 'approved') q.status = 'pending';
  }
  return { ok: true, restored, state: publicState(s) };
}

export function buildReport(id) {
  const s = getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  touch(s);
  const lines = [];
  lines.push(`# Resume Tailor Report`);
  if (s.targetCompany || s.targetRole) {
    lines.push(
      `Target: ${[s.targetRole, s.targetCompany].filter(Boolean).join(' @ ')}`
    );
  }
  lines.push('');
  lines.push('## Scores');
  lines.push(
    `- JD match: ${s.initialScores.jdMatchPct}% -> ${s.currentScores.jdMatchPct}%`
  );
  lines.push(
    `- ATS score: ${s.initialScores.atsScore} -> ${s.currentScores.atsScore}`
  );
  lines.push('');
  lines.push('## Changes applied');
  const approved = s.changeLog.filter((c) => c.action === 'approve');
  if (!approved.length) {
    lines.push('_None._');
  } else {
    for (const c of approved) {
      lines.push(`- [${c.section}] (${c.opAction}) ${c.preview}`);
    }
  }
  lines.push('');
  lines.push('## Rejected suggestions');
  const rejected = s.changeLog.filter((c) => c.action === 'reject');
  if (!rejected.length) {
    lines.push('_None._');
  } else {
    for (const c of rejected) {
      lines.push(`- [${c.section}] ${c.preview}`);
    }
  }
  lines.push('');
  lines.push('## Failed suggestions');
  const failed = s.changeLog.filter((c) => c.action === 'failed');
  if (!failed.length) {
    lines.push('_None._');
  } else {
    for (const c of failed) {
      lines.push(`- [${c.section}] ${c.error}`);
    }
  }
  lines.push('');
  lines.push('## Top missing JD keywords');
  for (const k of s.currentScores.missingKeywords.slice(0, 15)) {
    lines.push(`- ${k.keyword} (count ${k.count})`);
  }

  return {
    state: publicState(s),
    markdown: lines.join('\n'),
    changeLog: s.changeLog,
    initialScores: s.initialScores,
    currentScores: s.currentScores,
  };
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
