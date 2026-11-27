import { Check, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Person = { id: string; name: string; email?: string | null };

/** 选人：按名字或邮箱搜，点一下勾上或去掉。 */
export function PeoplePicker({
  label,
  people,
  value,
  onChange,
  trigger,
}: {
  label: string;
  people: readonly Person[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  trigger?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = people.filter(
    (p) => !query || p.name.toLowerCase().includes(query) || p.email?.toLowerCase().includes(query),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" aria-label={label}>
            <Plus />
            {label}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <SearchInput
          aria-label={`${label} 搜索`}
          placeholder="搜索姓名或邮箱"
          value={q}
          onChange={setQ}
          className="mb-1 w-full"
        />
        <ul aria-label={`${label} 候选`} className="flex max-h-64 flex-col overflow-y-auto">
          {shown.map((p) => {
            const on = value.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                  onClick={() => onChange(on ? value.filter((id) => id !== p.id) : [...value, p.id])}
                >
                  <Avatar id={p.id} name={p.name} size={20} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate">{p.name}</span>
                    {p.email && <span className="truncate text-fg-subtle text-xs">{p.email}</span>}
                  </span>
                  {on && <Check className="size-3.5 text-accent" />}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-2 py-2 text-fg-subtle">没有找到。</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
