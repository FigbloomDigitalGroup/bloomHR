import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";

const quickReactions = ['👍', '❤️', '😄', '😮', '😢', '😡'];

interface ReactionPickerProps {
  onReactionSelect: (emoji: string) => void;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ReactionPicker({ onReactionSelect, children, open, onOpenChange }: ReactionPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="flex gap-1">
          {quickReactions.map((emoji) => (
            <Button
              key={emoji}
              variant="ghost"
              className="h-8 w-8 p-0 text-lg hover:bg-muted"
              onClick={() => onReactionSelect(emoji)}
            >
              {emoji}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}