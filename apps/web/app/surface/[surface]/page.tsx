import { notFound } from "next/navigation";

import { ClinicShell } from "@/components/clinic-shell";
import { hasSurface, resolveSurfaceId } from "@/lib/navigation";

export default async function SurfacePage({ params }: { params: Promise<{ surface: string }> }) {
  const { surface } = await params;

  if (!hasSurface(surface)) {
    notFound();
  }

  return <ClinicShell initialSurfaceId={resolveSurfaceId(surface)} />;
}
