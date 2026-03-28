import { GoogleGenAI } from "@google/genai";
import { rateLimitRequest } from "./rateLimiter";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getCodeCompletion(code: string, language: string): Promise<string> {
  if (!code.trim() || !process.env.GEMINI_API_KEY) return "";

  return rateLimitRequest(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are an expert ${language} developer. Provide a short, relevant code completion for the following snippet. 
                Only return the completion text itself, no explanations, no markdown formatting, no code blocks.
                If no obvious completion exists, return an empty string.
                
                Code:
                ${code}`
              }
            ]
          }
        ],
        config: {
          temperature: 0.1,
          maxOutputTokens: 50,
        }
      });

      return response.text?.trim() || "";
    } catch (error: any) {
      const errorString = JSON.stringify(error).toLowerCase();
      const isQuotaError = 
        error?.status === 'RESOURCE_EXHAUSTED' || 
        error?.code === 429 || 
        error?.error?.code === 429 ||
        error?.response?.status === 429 ||
        errorString.includes("quota") ||
        errorString.includes("429") ||
        errorString.includes("resource_exhausted");

      if (isQuotaError) {
        console.warn("Gemini API Quota Exceeded. Suggestions temporarily disabled.");
        return "";
      }
      console.error("Error getting code completion:", error);
      return "";
    }
  });
}

export async function getAutoCorrection(code: string, language: string): Promise<string> {
  if (!code.trim() || !process.env.GEMINI_API_KEY) return code;

  return rateLimitRequest(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Fix any syntax errors or obvious logical mistakes in this ${language} code. 
                Return ONLY the corrected code, no explanations, no markdown formatting, no code blocks.
                
                Code:
                ${code}`
              }
            ]
          }
        ],
        config: {
          temperature: 0.1,
        }
      });

      return response.text?.trim() || code;
    } catch (error: any) {
      const errorString = JSON.stringify(error).toLowerCase();
      const isQuotaError = 
        error?.status === 'RESOURCE_EXHAUSTED' || 
        error?.code === 429 || 
        error?.error?.code === 429 ||
        error?.response?.status === 429 ||
        errorString.includes("quota") ||
        errorString.includes("429") ||
        errorString.includes("resource_exhausted");

      if (isQuotaError) {
        console.warn("Gemini API Quota Exceeded. Auto-correction unavailable.");
        return code;
      }
      console.error("Error getting auto correction:", error);
      return code;
    }
  });
}
