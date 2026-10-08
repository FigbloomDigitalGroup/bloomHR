import { createContext, useContext } from 'react';
import type { Employee } from '../types/types';

/** What the people cards in Teams need from the chat: everyone's records (with live status) and the actions. */
export interface ChatPeople {
  employees: Employee[];
  currentEmail?: string;
  /** opens (or starts) a direct message with this employee */
  onMessage?: (employeeId: string) => void;
  /** HR, managers and admins can open someone's employee record */
  canViewRecords: boolean;
}

export const ChatPeopleContext = createContext<ChatPeople>({ employees: [], canViewRecords: false });
export const useChatPeople = () => useContext(ChatPeopleContext);

/** A person shown in the chat (a message's author, a conversation, a sidebar entry) is any of these shapes. */
export interface ChatPerson {
  id?: string;
  name?: string;
  fullName?: string;
  email?: string;
  workEmail?: string;
  employeeNumber?: string;
  avatar?: string;
  profileImage?: string;
  initials?: string;
  status?: 'online' | 'away' | 'offline';
}

const lower = (v?: string | null) => (v || '').trim().toLowerCase();

/** The employee record behind a chat person: by employee number, then email, then name. */
export function findEmployee(employees: Employee[], person: ChatPerson): Employee | undefined {
  if (person.employeeNumber) {
    const byNumber = employees.find((e) => e.employeeNumber === person.employeeNumber);
    if (byNumber) return byNumber;
  }
  const email = lower(person.workEmail || person.email);
  if (email) {
    const byEmail = employees.find((e) => lower(e.workEmail) === email);
    if (byEmail) return byEmail;
  }
  // messages carry only the author's display name (which is their email when they had no employee record)
  const name = lower(person.fullName || person.name);
  if (!name) return undefined;
  return employees.find((e) => lower(e.fullName) === name || lower(e.workEmail) === name);
}
