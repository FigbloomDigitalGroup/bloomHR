// services/mentionService.ts
import type { Employee } from "../types/types";

export class MentionService {
  /**
   * Extract mention query from text
   */
  static getMentionQuery(text: string, cursorPosition: number): string | null {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtSymbol === -1) return null;
    
    const query = textBeforeCursor.substring(lastAtSymbol + 1);
    return query.trim();
  }

  /**
   * Check if we're currently in a mention
   */
  static isInMention(text: string, cursorPosition: number): boolean {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    
    return lastAtSymbol > lastSpace;
  }

  /**
   * Filter employees based on mention query
   */
  static filterEmployees(employees: Employee[], query: string): Employee[] {
    if (!query) return employees.slice(0, 10); // Return first 10 if no query
    
    const lowerQuery = query.toLowerCase();
    return employees
      .filter(emp => 
        emp.fullName.toLowerCase().includes(lowerQuery) ||
        emp.firstName.toLowerCase().includes(lowerQuery) ||
        emp.lastName.toLowerCase().includes(lowerQuery) ||
        emp.jobTitle.toLowerCase().includes(lowerQuery) ||
        emp.department.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 10); // Limit to 10 results
  }

  /**
   * Insert mention into text
   */
  static insertMention(
    originalText: string, 
    cursorPosition: number, 
    employee: Employee
  ): { newText: string; newCursorPosition: number } {
    const textBeforeCursor = originalText.substring(0, cursorPosition);
    const textAfterCursor = originalText.substring(cursorPosition);
    
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    const textBeforeAt = textBeforeCursor.substring(0, lastAtSymbol);
    
    const mentionText = `@${employee.fullName} `;
    const newText = textBeforeAt + mentionText + textAfterCursor;
    const newCursorPosition = textBeforeAt.length + mentionText.length;
    
    return { newText, newCursorPosition };
  }
}