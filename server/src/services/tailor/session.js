import { nanoid } from 'nanoid';

import { parseResume } from './texParser.js';
import { computeScores } from './scorer.js';
import { generateSuggestions, refineSuggestion } from './gemini.js';
import { applySuggestion, rollbackAll } from './texEditor.js';
import {
  abandonSession,
  cacheSession,
  evictExpiredFromDb,
  findLatestActiveDoc,
  loadSessionDoc,
  persistSessionDoc,
  touchSessionTimestamps,
} from './sessionPersistence.js';

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

function serializeResume(session) {
  return {
    id: session.id,
    kind: 'resume',
    status: session.status || 'active',
    cvRoot: session.cvRoot,
    jobDescription: session.jobDescription,
    targetRole: session.targetRole,
    targetCompany: session.targetCompany,
    seniority: session.seniority,
    tone: session.tone,
    initialScores: session.initialScores,
    currentScores: session.currentScores,
    queue: session.queue,
    totalSuggestions: session.totalSuggestions,
    changeLog: session.changeLog,
    touchedFiles: [...session.touchedFiles],
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    updatedAt: session.updatedAt,
  };
}

async function hydrateResume(doc) {
  const session = {
    id: doc.id,
    status: doc.status || 'active',
    cvRoot: doc.cvRoot,
    jobDescription: doc.jobDescription,
    targetRole: doc.targetRole || '',
    targetCompany: doc.targetCompany || '',
    seniority: doc.seniority || '',
    tone: doc.tone || '',
    initialScores: doc.initialScores,
    currentScores: doc.currentScores,
    queue: doc.queue || [],
    totalSuggestions: doc.totalSuggestions,
    changeLog: doc.changeLog || [],
    touchedFiles: new Set(doc.touchedFiles || []),
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    updatedAt: doc.updatedAt,
  };
  session.parsed = await parseResume(session.cvRoot);
  session.currentScores = computeScores(session.parsed, session.jobDescription);
  return session;
}

async function persistResume(session) {
  touchSessionTimestamps(session);
  const doc = serializeResume(session);
  await persistSessionDoc(doc);
  cacheSession('resume', session);
}

export function buildResumeRestorePayload(session) {
  const np = nextPending(session);
  return {
    session: publicState(session),
    jobDescription: session.jobDescription,
    targetRole: session.targetRole,
    targetCompany: session.targetCompany,
    seniority: session.seniority,
    tone: session.tone,
    firstSuggestion: publicSuggestion(np),
    done: !np,
    initialScores: session.initialScores,
    currentScores: session.currentScores,
  };
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
  await evictExpiredFromDb();
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
  const now = Date.now();
  const session = {
    id,
    status: 'active',
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
    createdAt: now,
    expiresAt: now,
    updatedAt: now,
  };
  await persistResume(session);
  return {
    ...publicState(session),
    firstSuggestion: publicSuggestion(nextPending(session)),
  };
}

export async function getSession(id) {
  await evictExpiredFromDb();
  const doc = await loadSessionDoc(id, 'resume');
  if (!doc) return null;
  const session = await hydrateResume(doc);
  cacheSession('resume', session);
  return session;
}

export async function getActiveResumeSession() {
  await evictExpiredFromDb();
  const doc = await findLatestActiveDoc('resume');
  if (!doc) return null;
  const session = await hydrateResume(doc);
  cacheSession('resume', session);
  return session;
}

export async function abandonResumeSession(id) {
  await abandonSession(id, 'resume');
}

export async function nextSuggestion(id) {
  const s = await getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  await persistResume(s);
  const np = nextPending(s);
  if (!np) {
    return { done: true, state: publicState(s) };
  }
  return { done: false, suggestion: publicSuggestion(np), state: publicState(s) };
}

// Roll the session's files back to their .bak baseline, reparse, then
// re-apply every queue entry currently marked 'approved' in queue order.
async function replayApprovedQueue(s) {
  await rollbackAll(s.touchedFiles);
  s.parsed = await parseResume(s.cvRoot);
  for (const q of s.queue) {
    if (q.status !== 'approved') continue;
    try {
      await applySuggestion(s.parsed, q, s.touchedFiles);
    } catch (err) {
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
  const s = await getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
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
      await persistResume(s);
      return respond({ result: 'rejected' });
    }
    sug.status = 'rejected';
    s.changeLog.push(logEntry('reject', sug));
    if (wasApproved) await replayApprovedQueue(s);
    await persistResume(s);
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
      await replayApprovedQueue(s);
      s.changeLog.push(logEntry('re-edit', sug));
      await persistResume(s);
      return { result: 'refined-applied', next: publicSuggestion(sug), state: publicState(s) };
    }
    sug.status = 'pending';
    await persistResume(s);
    return { result: 'refined', next: publicSuggestion(sug), state: publicState(s) };
  }

  if (decision === 'approve') {
    if (wasApproved) {
      await persistResume(s);
      return respond({ result: 'noop' });
    }
    if (sug.status === 'pending') {
      try {
        const change = await applySuggestion(s.parsed, sug, s.touchedFiles);
        sug.status = 'approved';
        s.changeLog.push(
          logEntry('approve', sug, { file: change.file, opAction: change.action })
        );
        s.currentScores = computeScores(s.parsed, s.jobDescription);
        await persistResume(s);
        return respond({ result: 'applied', change });
      } catch (err) {
        sug.status = 'failed';
        sug.error = err.message;
        s.changeLog.push(logEntry('failed', sug, { error: err.message }));
        await persistResume(s);
        return respond({ result: 'failed', error: err.message });
      }
    }
    sug.status = 'approved';
    try {
      await replayApprovedQueue(s);
      if (sug.status === 'failed') {
        s.changeLog.push(logEntry('failed', sug, { error: sug.error }));
        await persistResume(s);
        return respond({ result: 'failed', error: sug.error });
      }
      s.changeLog.push(logEntry('approve', sug, { opAction: sug.action }));
      await persistResume(s);
      return respond({ result: 'applied' });
    } catch (err) {
      sug.status = 'failed';
      sug.error = err.message;
      s.changeLog.push(logEntry('failed', sug, { error: err.message }));
      await persistResume(s);
      return respond({ result: 'failed', error: err.message });
    }
  }

  throw httpErr(400, `Unknown decision "${decision}".`);
}

export async function rollbackSession(id) {
  const s = await getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  const restored = await rollbackAll(s.touchedFiles);
  s.parsed = await parseResume(s.cvRoot);
  s.currentScores = computeScores(s.parsed, s.jobDescription);
  s.changeLog.push({
    at: new Date().toISOString(),
    action: 'rollback',
    restoredFiles: restored.length,
  });
  for (const q of s.queue) {
    if (q.status === 'approved') q.status = 'pending';
  }
  await persistResume(s);
  return { ok: true, restored, state: publicState(s) };
}

export async function buildReport(id) {
  const s = await getSession(id);
  if (!s) throw httpErr(404, 'Session not found or expired.');
  await persistResume(s);
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
