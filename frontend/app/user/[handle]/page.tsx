import ProfileScreen from "@/app/_components/ProfileScreen";

type UserProfilePageProps = {
  params: Promise<{
    handle: string;
  }>;
};

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { handle } = await params;
  return <ProfileScreen targetHandle={handle} />;
}
