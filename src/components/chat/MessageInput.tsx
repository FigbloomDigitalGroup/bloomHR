// components/MessageInput.tsx
import { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import { Send, Paperclip, Smile, AtSign, X, Reply } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { EmojiPicker } from "./EmojiPicker";
import { MentionPopover } from "./EmployeeMention";
import { ATTACHMENT_ACCEPT, attachmentProblem, MAX_ATTACHMENTS_PER_MESSAGE, messagePreview } from "./lib/attachments";
import type { Employee, Message } from "../chat/types/types";

interface MessageInputProps {
  channelName: string;
  /** sends the text, the files and the message being answered; resolves false when nothing was sent (keep the draft) */
  onSendMessage: (content: string, files: File[], replyTo?: Message | null) => Promise<boolean> | boolean | void;
  disabled?: boolean;
  employees: Employee[];
  /** the message being answered, shown above the box until sent or cancelled */
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  currentUserId?: string;
}

interface FilePreview {
  file: File;
  url: string;
}

export function MessageInput({
  channelName,
  onSendMessage,
  disabled = false,
  employees = [],
  replyingTo = null,
  onCancelReply,
  currentUserId,
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Starting a reply puts the cursor in the box, ready to type the answer.
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && files.length === 0) || disabled || sending) return;

    // the files themselves go with the message (they used to be dropped and replaced by "Sent 1 file(s)")
    setSending(true);
    let sent: boolean | void;
    try {
      sent = await onSendMessage(message.trim(), files.map(f => f.file), replyingTo);
    } finally {
      setSending(false);
    }
    if (sent === false) return; // the reason was shown; the text and files stay to try again

    files.forEach(f => URL.revokeObjectURL(f.url));
    setMessage("");
    setFiles([]);
    onCancelReply?.();
  };

  const handleAttachment = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // the same file can be picked again after it was removed
    e.target.value = '';
    const accepted: File[] = [];
    for (const file of selectedFiles) {
      const problem = attachmentProblem(file);
      if (problem) toast.error(problem);
      else accepted.push(file);
    }
    const room = MAX_ATTACHMENTS_PER_MESSAGE - files.length;
    if (accepted.length > room) toast.error(`Send at most ${MAX_ATTACHMENTS_PER_MESSAGE} files in one message`);
    const newFiles = accepted.slice(0, Math.max(room, 0)).map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].url);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleMentionSelect = (employee: Employee) => {
    setMessage(prev => prev + `@${employee.fullName} `);
    setShowMentionPicker(false);
  };

  const handleMentionButtonClick = () => {
    if (textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setMentionPosition({
        top: rect.top - 300, // Position above the input
        left: rect.left + 10
      });
    }
    setShowMentionPicker(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    } else if (e.key === "Escape" && replyingTo) {
      onCancelReply?.();
    }
  };

  // Close mention popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showMentionPicker && !(e.target as Element).closest('.mention-popover-container')) {
        setShowMentionPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionPicker]);



  return (
    <div className="border-t border-border p-4 bg-card mention-popover-container">
      {/* The message being answered */}
      {replyingTo && (
        <div className="flex items-start gap-2 mb-2 rounded-md border-l-4 border-brand bg-green-tint px-3 py-2">
          <Reply className="h-4 w-4 mt-0.5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-brand">
              Replying to {replyingTo.author.id === currentUserId ? 'yourself' : replyingTo.author.name}
            </div>
            <div className="truncate text-gray-600">{messagePreview(replyingTo)}</div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white hover:text-gray-700"
            aria-label="Cancel reply"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* File Previews */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {files.map((file, index) => (
            <div key={index} className="relative group">
              {file.file.type.startsWith('image/') ? (
                <img
                  src={file.url}
                  alt={file.file.name}
                  className="h-16 w-16 object-cover rounded border"
                />
              ) : (
                <div className="h-16 w-16 border rounded flex items-center justify-center bg-muted">
                  <Paperclip className="h-6 w-6" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label={`Remove ${file.file.name}`}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="text-xs mt-1 max-w-16 truncate">
                {file.file.name}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Channel is muted" : `Message #${channelName}`}
            className="min-h-[80px] pr-12 resize-none bg-background disabled:opacity-50"
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              className="hidden"
              accept={ATTACHMENT_ACCEPT}
              aria-label="Attach files"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleAttachment}
              disabled={disabled || sending}
              aria-label="Attach a file (up to 25 MB)"
              title="Attach a file (up to 25 MB)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            <EmojiPicker
              onEmojiSelect={handleEmojiSelect}
              open={showEmojiPicker}
              onOpenChange={setShowEmojiPicker}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={disabled}
              >
                <Smile className="h-4 w-4" />
              </Button>
            </EmojiPicker>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleMentionButtonClick}
              disabled={disabled}
            >
              <AtSign className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="submit"
            disabled={(!message.trim() && files.length === 0) || disabled || sending}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {sending ? (files.length ? 'Uploading…' : 'Sending…') : 'Send'}
          </Button>
        </div>
      </form>

      {/* Mention Popover */}
      {showMentionPicker && (
        <MentionPopover
          employees={employees}
          query=""
          position={mentionPosition}
          onSelect={handleMentionSelect}
          onClose={() => setShowMentionPicker(false)}
        />
      )}
    </div>
  );
}