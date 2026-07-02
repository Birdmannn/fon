import type { Metadata } from "next";

import ProfileScreen from "@/app/_components/ProfileScreen";

type UserProfilePageProps = {
  params: Promise<{
    handle: string;
  }>;
};

function formatHandleTitle(handle: string) {
  const normalized = handle.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "User";
}

export async function generateMetadata({ params }: UserProfilePageProps): Promise<Metadata> {
  const { handle } = await params;
  const titleHandle = formatHandleTitle(handle);

  return {
    title: `${titleHandle} • FreightOnNervos`,
    description: `View ${titleHandle}'s FreightOnNervos profile.`,
  };
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { handle } = await params;
  return <ProfileScreen targetHandle={handle} />;
}
