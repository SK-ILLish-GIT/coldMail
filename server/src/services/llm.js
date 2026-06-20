import { GoogleGenerativeAI } from '@google/generative-ai';

import {
  getAiModel,
  getAiProvider,
  isProviderConfigured,
} from './aiModel.js';

let geminiClient = null;

function getGeminiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.status = 503;
    throw err;
  }
  return key;
}

function getGroqKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    const err = new Error('GROQ_API_KEY is not configured on the server.');
    err.status = 503;
    throw err;
  }
  return key;
}

function getGeminiClient() {
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(getGeminiKey());
  return geminiClient;
}

function providerLabel(provider) {
  return provider === 'groq' ? 'Groq' : 'Gemini';
}

function schemaInstruction(schema) {
  return `Respond with valid JSON only (no markdown fences) matching this schema:\n${JSON.stringify(schema)}`;
}

function parseJsonResponse(text, provider) {
  if (!text?.trim()) {
    throw new Error(`${providerLabel(provider)} returned an empty response.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerLabel(provider)} returned non-JSON content.`);
  }
}

async function callGemini({ systemPrompt, userPrompt, schema, temperature, parts }) {
  const gen = getGeminiClient();
  const model = gen.getGenerativeModel({
    model: getAiModel(),
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  const input = parts?.length ? parts : userPrompt;
  const result = await model.generateContent(input);
  const text = result?.response?.text?.();
  return parseJsonResponse(text, 'gemini');
}

async function callGroq({ systemPrompt, userPrompt, schema, temperature }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getGroqKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getAiModel(),
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n\n${schemaInstruction(schema)}`,
        },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `Groq API error (${res.status}): ${body.slice(0, 400) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return parseJsonResponse(text, 'groq');
}

function hasMultimodalParts(parts) {
  return Array.isArray(parts) && parts.some((p) => p?.inlineData);
}

/**
 * Generate structured JSON from the active AI provider.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {object} opts.schema - JSON schema (Gemini native; embedded in prompt for Groq)
 * @param {number} [opts.temperature=0.2]
 * @param {Array} [opts.parts] - Gemini multimodal parts; PDF uploads auto-fallback to Gemini
 */
export async function generateStructuredJson({
  systemPrompt,
  userPrompt,
  schema,
  temperature = 0.2,
  parts,
}) {
  let provider = getAiProvider();

  if (hasMultimodalParts(parts)) {
    if (provider === 'groq') {
      if (isProviderConfigured('gemini')) {
        provider = 'gemini';
      } else {
        const err = new Error(
          'PDF analysis requires Gemini. Set GEMINI_API_KEY or switch provider to Gemini in settings.'
        );
        err.status = 503;
        throw err;
      }
    }
  }

  if (!isProviderConfigured(provider)) {
    const keyName = provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY';
    const err = new Error(`${keyName} is not configured on the server.`);
    err.status = 503;
    throw err;
  }

  if (provider === 'groq') {
    return callGroq({ systemPrompt, userPrompt, schema, temperature });
  }

  return callGemini({ systemPrompt, userPrompt, schema, temperature, parts });
}

export function isLlmConfigured() {
  return isProviderConfigured('gemini') || isProviderConfigured('groq');
}
