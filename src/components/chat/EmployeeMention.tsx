// components/MentionPopover.tsx
import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Search } from "lucide-react";
import type { Employee } from "../chat/types/types";

interface MentionPopoverProps {
  employees: Employee[];
  query: string;
  position: { top: number; left: number };
  onSelect: (employee: Employee) => void;
  onClose: () => void;
}

export function MentionPopover({ 
  employees, 
  query, 
  position, 
  onSelect, 
  onClose 
}: MentionPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(query);

  // Filter employees based on search query
  const filteredEmployees = employees.filter(emp =>
    emp.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.workEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredEmployees.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : filteredEmployees.length - 1
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredEmployees[selectedIndex]) {
          onSelect(filteredEmployees[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredEmployees, selectedIndex, onSelect, onClose]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  if (filteredEmployees.length === 0) {
    return (
      <div 
        className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-80 max-w-sm max-h-96 overflow-hidden"
        style={{ top: position.top, left: position.left }}
      >
        <div className="p-3 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-700 mb-2">
            Mention someone
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="p-4 text-center text-gray-500 text-sm">
          No employees found
        </div>
      </div>
    );
  }

  return (
    <div 
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-80 max-w-sm max-h-96 overflow-hidden"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header with Search */}
      <div className="p-3 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-700 mb-2">
          Mention someone ({filteredEmployees.length})
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search employees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            autoFocus
          />
        </div>
      </div>
      
      {/* Employees List with Scroll */}
      <ScrollArea className="h-64">
        <div className="p-1">
          {filteredEmployees.map((employee, index) => (
            <div
              key={employee.id}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                index === selectedIndex 
                  ? 'bg-blue-50 border border-blue-200' 
                  : 'hover:bg-gray-50'
              }`}
              onClick={() => onSelect(employee)}
            >
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarImage src={employee.profileImage} />
                <AvatarFallback className="text-xs">
                  {employee.initials}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900 truncate">
                    {employee.fullName}
                  </span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {employee.status}
                  </Badge>
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {employee.jobTitle}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {employee.department}
                  {employee.town && ` • ${employee.town}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      
      {/* Footer */}
      <div className="p-2 border-t border-gray-100 bg-gray-50">
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span>↑↓ to navigate</span>
          <span>Enter to select</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}