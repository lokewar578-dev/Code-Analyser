export interface LocalDebugResult {
  detectedLanguage: string;
  errors: { line: number; description: string; type: string; suggestion: string }[];
  errorLines: number[];
  explanation: string;
  suggestedFix: string;
}

export function validateCode(code: string): LocalDebugResult {
  const lines = code.split('\n');
  const errors: { line: number; description: string; type: string; suggestion: string }[] = [];
  const errorLines: number[] = [];

  // Very basic syntax checks
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    
    // Check for unbalanced braces
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        line: lineNumber,
        description: "Unbalanced braces detected.",
        type: "Syntax",
        suggestion: "Check your braces."
      });
      errorLines.push(lineNumber);
    }
    
    // Check for missing semicolons (basic check for common languages)
    if (line.trim() && !line.trim().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}') && !line.trim().endsWith(':')) {
      // This is very noisy, so maybe only flag if it looks like a statement
      if (line.trim().length > 5 && !line.trim().startsWith('//')) {
        errors.push({
          line: lineNumber,
          description: "Potential missing semicolon.",
          type: "Style",
          suggestion: "Add a semicolon at the end of the line."
        });
        errorLines.push(lineNumber);
      }
    }
  });

  return {
    detectedLanguage: "unknown",
    errors,
    errorLines,
    explanation: errors.length > 0 ? "Basic syntax issues found." : "No obvious syntax errors found.",
    suggestedFix: code
  };
}
