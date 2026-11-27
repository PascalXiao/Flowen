import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { CreateSpaceDialog } from "@/components/CreateSpaceDialog";
import { Button } from "@/components/ui/button";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        新建空间
      </Button>
      <CreateSpaceDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
