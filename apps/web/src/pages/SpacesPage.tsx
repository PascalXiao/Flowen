import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { newId } from "@/lib/utils";

export function SpacesPage() {
  const [spaces, result] = useQuery(queries.spaces.mine());
  useActiveSpace(null);

  return (
    <>
      <PageHeader title="我的空间" actions={<CreateSpace />} />
      <PageBody>
        {spaces.length === 0 && result.type === "complete" ? (
          <EmptyState
            title="还没有空间"
            description="空间是一个团队协作的地方：里面有工作项类型、流程和成员。先建一个。"
            action={<CreateSpace />}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((space) => (
              <li key={space.id}>
                <Link
                  to="/spaces/$spaceId"
                  params={{ spaceId: space.id }}
                  className="flex items-center gap-3 rounded-lg border border-line-subtle bg-surface p-4 shadow-card transition-colors hover:border-accent"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-base font-semibold text-violet-600">
                    {space.name.slice(0, 1)}
                  </span>
                  <span className="truncate font-medium">{space.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function CreateSpace() {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    zero.mutate(mutators.space.create({ id: newId(), name: name.trim() }));
    setName("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          新建空间
        </Button>
      </DialogTrigger>
      <DialogContent title="新建空间">
        <form className="flex flex-col gap-5" onSubmit={create}>
          <Field label="空间名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">创建</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
