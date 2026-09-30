export interface TabBarItem {
  id: string;
  label: string;
}

interface TabBarProps {
  items: TabBarItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'underline' | 'pill';
  className?: string;
}

export default function TabBar({ items, activeId, onChange, variant = 'underline', className = '' }: TabBarProps) {
  if (variant === 'pill') {
    return (
      <div className={`inline-flex items-center gap-1 bg-secondary rounded-pill p-1 ${className}`}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`px-3.5 py-1.5 rounded-pill text-[12.5px] font-semibold transition-colors ${
                isActive ? 'bg-brand text-white' : 'text-muted-foreground hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex gap-[22px] ${className}`}>
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`text-[13px] pb-2 border-b-2 transition-colors ${
              isActive
                ? 'font-bold text-brand border-brand'
                : 'font-medium text-subtle border-transparent hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
