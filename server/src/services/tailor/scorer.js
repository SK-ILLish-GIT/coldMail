// Deterministic, no-AI scoring of a resume vs a JD. Fast enough to recompute
// on every approval. Uses lightweight token normalisation (no NLP deps).

// Words that show up in nearly every JD/resume and would dominate cosine sim.
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','for','to','of','in','on',
  'with','as','at','by','from','this','that','these','those','is','are','was',
  'were','be','been','being','it','its','we','our','you','your','they','their',
  'i','my','me','will','can','should','must','may','have','has','had','do',
  'does','did','not','no','yes','so','than','about','into','over','under',
  'across','per','via','within','using','use','used','using','make','made',
  'work','working','team','teams','role','roles','job','jobs','candidate',
  'experience','experiences','year','years','responsibilities','responsibility',
  'requirements','requirement','strong','solid','excellent','good','great',
  'ability','abilities','skill','skills','plus','etc','including','include',
  'includes','any','all','also','more','most','other','others','one','two',
  'three','etc','minimum','preferred','required','desired','nice',
]);

// Quantitative / impact tokens we want to encourage. Used by the ATS heuristic
// (does the bullet contain a number, percent, dollar sign, etc.).
const QUANT_RE = /\d|%|\$|reduced|increased|improved|cut|saved|grew|scaled|delivered|achieved/i;

const ACTION_VERBS = new Set([
  'architected','built','developed','designed','implemented','migrated',
  'optimized','optimised','reduced','launched','shipped','automated',
  'integrated','created','led','owned','orchestrated','refactored','rolled',
  'deployed','engineered','scaled','streamlined','accelerated','delivered',
  'monitored','instrumented','tuned','debugged','spearheaded','authored',
  'productionised','productionized','prototyped','researched','mentored',
  'analysed','analyzed','benchmarked','profiled',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#./-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^[.\-+#/]+|[.\-+#/]+$/g, ''))
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
}

function freq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function cosine(a, b) {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (const v of a.values()) aMag += v * v;
  for (const v of b.values()) bMag += v * v;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  if (!aMag || !bMag) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

// Bigrams capture multi-word tech terms ("spring boot", "ci cd", "system design").
function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/**
 * Compute JD match % and missing keywords.
 * Returns { matchPct, jdTokens: top tokens with weights, missingKeywords: [...] }.
 */
export function scoreJDMatch(resumeText, jdText) {
  const rTokens = tokenize(resumeText);
  const jTokens = tokenize(jdText);
  const rFreq = freq([...rTokens, ...bigrams(rTokens)]);
  const jFreq = freq([...jTokens, ...bigrams(jTokens)]);
  const sim = cosine(rFreq, jFreq);

  // Missing keywords: anything in the JD that's not in the resume. We require
  // count>=2 for both unigrams and bigrams — for a short JD this filters out
  // noise like "senior software" appearing once; for a long JD the genuinely
  // emphasised terms (kubernetes, ci/cd, etc.) bubble to the top.
  const missing = [];
  const seenInResume = new Set([...rFreq.keys()]);
  for (const [k, v] of jFreq.entries()) {
    if (v < 2) continue;
    if (seenInResume.has(k)) continue;
    // Skip pure-numeric tokens or year-range fragments.
    if (/^\d+$/.test(k)) continue;
    missing.push({ keyword: k, count: v });
  }
  // If we filtered too aggressively (short JD), fall back to count>=1 unigrams.
  if (missing.length < 5) {
    for (const [k, v] of jFreq.entries()) {
      if (k.includes(' ')) continue;
      if (seenInResume.has(k)) continue;
      if (/^\d+$/.test(k)) continue;
      if (missing.find((m) => m.keyword === k)) continue;
      missing.push({ keyword: k, count: v });
    }
  }
  missing.sort((a, b) => b.count - a.count);

  return {
    matchPct: Math.round(sim * 1000) / 10, // one decimal place
    missingKeywords: missing.slice(0, 25),
    jdTopTokens: [...jFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([k, v]) => ({ keyword: k, count: v })),
  };
}

/**
 * Heuristic ATS-friendliness score over the parsed resume.
 * Returns { score: 0-100, checks: [...] }.
 */
export function scoreATS(parsed) {
  const checks = [];
  let score = 0;

  const headerRaw = parsed.files.find((f) => f.rel.endsWith('header.tex'))?.raw || '';
  const mainRaw = parsed.files.find((f) => f.rel === 'main.tex')?.raw || '';
  const hasEmail =
    /mailto:|@/.test(headerRaw) ||
    /\\emaila|\\newcommand\{\s*\\emaila/.test(mainRaw);
  checks.push({ label: 'Contact email present', pass: hasEmail, weight: 10 });
  if (hasEmail) score += 10;

  const hasPhone = /\\wpnumber|Contact Number|\+\d|\(\+\d/.test(`${headerRaw}\n${mainRaw}`);
  checks.push({ label: 'Phone number present', pass: hasPhone, weight: 8 });
  if (hasPhone) score += 8;

  const hasLinkedIn = /linkedin\.com/i.test(`${headerRaw}\n${mainRaw}`);
  checks.push({ label: 'LinkedIn URL present', pass: hasLinkedIn, weight: 6 });
  if (hasLinkedIn) score += 6;

  // Bullets
  const allBullets = [];
  for (const sec of Object.values(parsed.sections)) {
    for (const b of sec.bullets || []) allBullets.push({ sec: sec.id, ...b });
  }
  const totalBullets = allBullets.length;
  checks.push({
    label: 'Has at least 8 bullets across resume',
    pass: totalBullets >= 8,
    weight: 8,
    detail: `${totalBullets} bullets`,
  });
  if (totalBullets >= 8) score += 8;

  // Action verbs
  const actionStarts = allBullets.filter((b) => {
    const first = b.text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    return first && ACTION_VERBS.has(first);
  }).length;
  const actionRatio = totalBullets ? actionStarts / totalBullets : 0;
  checks.push({
    label: 'Bullets start with strong action verbs',
    pass: actionRatio >= 0.4,
    weight: 14,
    detail: `${Math.round(actionRatio * 100)}% start with an action verb`,
  });
  score += Math.round(14 * Math.min(1, actionRatio / 0.6));

  // Quantified
  const quant = allBullets.filter((b) => QUANT_RE.test(b.text)).length;
  const quantRatio = totalBullets ? quant / totalBullets : 0;
  checks.push({
    label: 'Bullets contain numbers / impact metrics',
    pass: quantRatio >= 0.3,
    weight: 16,
    detail: `${Math.round(quantRatio * 100)}% quantified`,
  });
  score += Math.round(16 * Math.min(1, quantRatio / 0.5));

  // Length per bullet — punish absurdly long bullets (> 35 words).
  const longBullets = allBullets.filter((b) => b.text.split(/\s+/).length > 35).length;
  checks.push({
    label: 'No excessively long bullets',
    pass: longBullets === 0,
    weight: 6,
    detail: longBullets ? `${longBullets} long bullet(s)` : 'OK',
  });
  if (longBullets === 0) score += 6;

  // Summary
  const summary = parsed.sections.summary?.summary?.text || '';
  const summaryWords = summary.split(/\s+/).filter(Boolean).length;
  checks.push({
    label: 'Summary length 25-60 words',
    pass: summaryWords >= 25 && summaryWords <= 60,
    weight: 6,
    detail: `${summaryWords} words`,
  });
  if (summaryWords >= 25 && summaryWords <= 60) score += 6;

  // Skills present
  const skillsCount = parsed.sections.skills?.skillsLines?.length || 0;
  checks.push({
    label: 'Skills section populated',
    pass: skillsCount >= 3,
    weight: 8,
    detail: `${skillsCount} skill groups`,
  });
  if (skillsCount >= 3) score += 8;

  // Experience present
  const expSubs = parsed.sections.experience?.subheadings?.length || 0;
  checks.push({
    label: 'At least one work experience',
    pass: expSubs >= 1,
    weight: 10,
    detail: `${expSubs} experience block(s)`,
  });
  if (expSubs >= 1) score += 10;

  // Projects present
  const projSubs = parsed.sections.projects?.subheadings?.length || 0;
  checks.push({
    label: 'At least two projects',
    pass: projSubs >= 2,
    weight: 8,
    detail: `${projSubs} project(s)`,
  });
  if (projSubs >= 2) score += 8;

  return {
    score: Math.min(100, score),
    checks,
  };
}

/**
 * Combined scoring helper used by the route layer.
 */
export function computeScores(parsed, jdText) {
  const jd = scoreJDMatch(parsed.plainText, jdText || '');
  const ats = scoreATS(parsed);
  return {
    jdMatchPct: jd.matchPct,
    atsScore: ats.score,
    atsChecks: ats.checks,
    missingKeywords: jd.missingKeywords,
    jdTopTokens: jd.jdTopTokens,
  };
}
