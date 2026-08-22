import React from "react";
import { Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DockerContainer } from "@/types";
import { ContainerCard } from "./ContainerCard.tsx";

interface ContainerListProps {
  containers: DockerContainer[];
  sessionId: string;
  onSelectContainer: (containerId: string) => void;
  selectedContainerId?: string | null;
  onRefresh?: () => void;
  search?: string;
  statusFilter?: string;
  viewLayout?: "grid" | "compact";
}

export function ContainerList({
  containers,
  sessionId,
  onSelectContainer,
  selectedContainerId = null,
  onRefresh,
  search = "",
  statusFilter = "all",
  viewLayout = "grid",
}: ContainerListProps): React.ReactElement {
  const { t } = useTranslation();

  const filtered = React.useMemo(() => {
    return containers.filter((c) => {
      const name = c.name.startsWith("/") ? c.name.slice(1) : c.name;
      const matchesSearch =
        name.toLowerCase().includes(search.toLowerCase()) ||
        c.image.toLowerCase().includes(search.toLowerCase()) ||
        c.id.toLowerCase().includes(search.toLowerCase());
      return (
        matchesSearch && (statusFilter === "all" || c.state === statusFilter)
      );
    });
  }, [containers, search, statusFilter]);

  if (containers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <Box className="size-16 mb-4" />
        <span className="text-xl font-bold uppercase tracking-widest">
          {t("docker.noContainersFound")}
        </span>
        <span className="text-xs font-semibold">
          {t("docker.noContainersFoundHint")}
        </span>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <Box className="size-16 mb-4" />
        <span className="text-xl font-bold uppercase tracking-widest">
          {t("docker.noContainersMatchFilters")}
        </span>
        <span className="text-xs font-semibold">
          {t("docker.noContainersMatchFiltersHint")}
        </span>
      </div>
    );
  }

  if (viewLayout === "compact") {
    return (
      <div className="border border-border bg-card overflow-x-auto thin-scrollbar">
        <div className="flex flex-col min-w-[540px]">
          {filtered.map((container) => (
            <ContainerCard
              key={container.id}
              container={container}
              sessionId={sessionId}
              onSelect={() => onSelectContainer(container.id)}
              isSelected={selectedContainerId === container.id}
              onRefresh={onRefresh}
              variant="compact"
            />
          ))}
        </div>
      </div>
    );
  }

  const grid = (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {filtered.map((container) => (
        <ContainerCard
          key={container.id}
          container={container}
          sessionId={sessionId}
          onSelect={() => onSelectContainer(container.id)}
          isSelected={selectedContainerId === container.id}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );

  // On narrow screens the 4-column grid collapses to 1 column and cards get
  // tall; let the grid keep a readable minimum width so it scrolls
  // horizontally inside the page's vertical scroller instead of crushing.
  if (viewLayout === "grid") {
    return (
      <div className="overflow-x-auto thin-scrollbar">
        <div className="min-w-[320px]">{grid}</div>
      </div>
    );
  }

  return grid;
}
