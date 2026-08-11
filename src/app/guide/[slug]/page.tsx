import { notFound } from "next/navigation";
import { GuideDetailPage } from "@/components/guide/guide-detail-page";
import { GUIDES, getGuide, isGuideSlug } from "@/lib/guides";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isGuideSlug(slug)) notFound();
  const guide = getGuide(slug);
  if (!guide) notFound();
  return <GuideDetailPage guide={guide} />;
}
