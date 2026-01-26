import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Search } from "lucide-react";
import { useState } from "react";
import type { Channel, DirectMessage, Message } from "../chat/types/types";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel | DirectMessage;
  messages: Message[];
}

export function SearchDialog({ open, onOpenChange, channel, messages }: SearchDialogProps) {
  const [query, setQuery] = useState("");

  const filteredMessages = messages.filter(message =>
    message.content.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search in {channel.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search messages..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {filteredMessages.map((message) => (
              <div key={message.id} className="p-3 border-b last:border-b-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{message.author.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(message.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">{message.content}</p>
              </div>
            ))}
            
            {query && filteredMessages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No messages found for "{query}"
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}