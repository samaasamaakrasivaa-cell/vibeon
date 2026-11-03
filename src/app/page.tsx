import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";

/** Стартовая страница сайта: вошедший — в свой кабинет, остальные — на вход. */
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}
