import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { rateLimitRequest } from "../lib/rateLimiter";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Simple in-memory cache for debug results
const debugCache = new Map<string, DebugResult>();

export interface DebugError {
  line: number;
  description: string;
  type: string;
  suggestion: string;
}

export interface DebugResult {
  detectedLanguage: string;
  errors: DebugError[];
  errorLines: number[];
  explanation: string;
  suggestedFix: string;
  expectedOutput: string;
  learningMoment: string;
  codeBreakdown: { line: string; explanation: string }[];
  verifiedResources: { title: string; url: string }[];
}

export async function debugCode(code: string, onChunk: (chunk: string) => void): Promise<DebugResult> {
  const trimmedCode = code.trim();
  if (!trimmedCode) throw new Error("Code is empty");

  // Check cache first
  if (debugCache.has(trimmedCode)) {
    return debugCache.get(trimmedCode)!;
  }

  return rateLimitRequest(async () => {
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      Analyze this code for errors.
      Return JSON:
      {
        "detectedLanguage": "string",
        "errors": [{"line": number, "description": "string", "type": "string", "suggestion": "string"}],
        "errorLines": [number],
        "explanation": "string",
        "suggestedFix": "FULL corrected code",
        "verifiedResources": [{"title": "string", "url": "string"}]
      }
      
      CODE:
      ${code.substring(0, 2000)}
    `;

    try {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          temperature: 0,
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }] // Add Google Search tool
        }
      });

      let fullResponse = "";
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullResponse += chunk.text;
          onChunk(chunk.text);
        }
      }

      if (!fullResponse) {
        throw new Error("Empty response from AI.");
      }

      const result = JSON.parse(fullResponse);
      
      // Cache the result
      debugCache.set(trimmedCode, result);
      
      return result;
    } catch (error: any) {
      console.error("Debug error:", error);
      throw new Error(error instanceof Error ? error.message : "Analysis failed. Please try again.");
    }
  });
}
