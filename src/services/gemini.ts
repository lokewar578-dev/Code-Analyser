import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Simple in-memory cache for debug results
const debugCache = new Map<string, DebugResult>();

export interface DebugResult {
  detectedLanguage: string;
  errors: string[];
  errorLines: number[];
  explanation: string;
  suggestedFix: string;
  expectedOutput: string;
  learningMoment: string;
  codeBreakdown: { line: string; explanation: string }[];
}

export async function debugCode(code: string, retryCount = 0): Promise<DebugResult> {
  const trimmedCode = code.trim();
  if (!trimmedCode) throw new Error("Code is empty");

  // Check cache first
  if (debugCache.has(trimmedCode)) {
    return debugCache.get(trimmedCode)!;
  }

  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Analyze this code for errors. Be fast and precise.
    If correct, set errors: [], errorLines: [], explanation: "The code is already correct.".
    
    CRITICAL: In "suggestedFix", return the FULL code with fixes. NO TRUNCATION.
    For errors, start with "Line X: ".
    
    CODE:
    ${code}
    
    Return JSON:
    {
      "detectedLanguage": "string",
      "errors": ["Line X: description"],
      "errorLines": [number],
      "explanation": "string",
      "suggestedFix": "FULL corrected code",
      "expectedOutput": "string",
      "learningMoment": "string",
      "codeBreakdown": [{"line": "string", "explanation": "string"}]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0, // Maximum speed and determinism
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING },
            errors: { type: Type.ARRAY, items: { type: Type.STRING } },
            errorLines: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            explanation: { type: Type.STRING },
            suggestedFix: { type: Type.STRING },
            expectedOutput: { type: Type.STRING },
            learningMoment: { type: Type.STRING },
            codeBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  line: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ["line", "explanation"]
              }
            }
          },
          required: ["detectedLanguage", "errors", "errorLines", "explanation", "suggestedFix", "expectedOutput", "learningMoment", "codeBreakdown"]
        }
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI.");
    }

    const result = JSON.parse(response.text);
    
    // Cache the result
    debugCache.set(trimmedCode, result);
    
    return result;
  } catch (error: any) {
    console.error(`Debug error (attempt ${retryCount + 1}):`, error);
    
    // Check for quota exceeded (429)
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuota = 
      error?.status === 'RESOURCE_EXHAUSTED' || 
      error?.code === 429 || 
      error?.error?.code === 429 ||
      error?.response?.status === 429 ||
      errorString.includes("quota") ||
      errorString.includes("429") ||
      errorString.includes("resource_exhausted");

    if (isQuota) {
      throw new Error("Gemini API Quota Exceeded. Please wait a minute before trying again or check your API key usage limits.");
    }
    
    // Automatic retry for transient RPC/XHR errors (max 2 retries)
    const isTransient = error.message?.includes("Rpc failed") || error.message?.includes("xhr error") || error.message?.includes("500");
    if (isTransient && retryCount < 2) {
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return debugCode(code, retryCount + 1);
    }
    
    if (isTransient) {
      throw new Error("The code might be too large for a single analysis or there's a temporary connection issue. Please try a smaller snippet or click 'Debug' again.");
    }
    
    throw new Error(error instanceof Error ? error.message : "Analysis failed. Please try again.");
  }
}
